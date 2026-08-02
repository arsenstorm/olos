import type { DirectPublicSecurityPolicy } from "../types/direct-public-security-policy";
import type { ProviderCapabilityDocument } from "../types/provider-capability";
import { isSafeObjectKey } from "../validation/object-key";
import { assertProviderCapabilityDocument } from "../validation/provider-capability";
import { createDeliveryCachePolicy } from "./cache-policy";

/** Options for {@link createDirectPublicSecurityPolicy}. */
export interface CreateDirectPublicSecurityPolicyOptions {
  capability: ProviderCapabilityDocument;
  /** Max age in seconds for the manifest cache policy (default 1). */
  manifestMaxAgeSeconds?: number;
  /**
   * Latency budget in seconds bounding the manifest and negative-object
   * cache policies (default 3).
   */
  targetLatencySeconds?: number;
}

/** Reason a direct-public media request must be blocked. */
export type DirectPublicMediaRequestBlockReason =
  | "document-navigation"
  | "html-accept"
  | "unsafe-object-key"
  | "unsupported-extension";

/**
 * Verdict from {@link resolveDirectPublicMediaRequestPolicy}: either the
 * request may be served, or it must be answered with the given HTTP
 * status (404 for unsafe or unsupported object keys, 403 for document
 * navigations and HTML requests).
 */
export type DirectPublicMediaRequestPolicy =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: DirectPublicMediaRequestBlockReason;
      status: 403 | 404;
    };

/** Options for {@link resolveDirectPublicMediaRequestPolicy}. */
export interface ResolveDirectPublicMediaRequestPolicyOptions {
  /** `Accept` request header; requests accepting `text/html` are blocked. */
  accept?: string | null;
  /** `Sec-Fetch-Dest` request header; `document` requests are blocked. */
  fetchDestination?: string | null;
  /** `Sec-Fetch-Mode` request header; `navigate` requests are blocked. */
  fetchMode?: string | null;
  objectKey: string;
}

/** Options for {@link createDirectPublicMediaResponseHeaders}. */
export interface CreateDirectPublicMediaResponseHeadersOptions {
  objectKey: string;
  policy: DirectPublicSecurityPolicy;
}

/** Options for {@link createDirectPublicNegativeObjectResponseHeaders}. */
export interface CreateDirectPublicNegativeObjectResponseHeadersOptions {
  objectKey: string;
  policy: DirectPublicSecurityPolicy;
}

interface DirectPublicCapabilityRequirement {
  isSupported: (capability: ProviderCapabilityDocument) => boolean;
  message: string;
}

interface DirectPublicMediaRequestBlockRule {
  isBlocked: (options: ResolveDirectPublicMediaRequestPolicyOptions) => boolean;
  reason: DirectPublicMediaRequestBlockReason;
  status: 403 | 404;
}

const DIRECT_PUBLIC_CAPABILITY_REQUIREMENTS = [
  {
    isSupported: (capability) =>
      capability.publication.directObjectPublication === true,
    message:
      "providerCapability.publication.directObjectPublication must be true for direct-public security",
  },
  {
    isSupported: (capability) =>
      capability.publication.manifestGatedPublication === true,
    message:
      "providerCapability.publication.manifestGatedPublication must be true for direct-public security",
  },
  {
    isSupported: (capability) =>
      capability.delivery.documentNavigationCanBeBlocked === true,
    message:
      "providerCapability.delivery.documentNavigationCanBeBlocked must be true for direct-public security",
  },
] satisfies readonly DirectPublicCapabilityRequirement[];

const DIRECT_PUBLIC_MEDIA_REQUEST_BLOCK_RULES = [
  {
    isBlocked: (options) => !isSafeObjectKey(options.objectKey),
    reason: "unsafe-object-key",
    status: 404,
  },
  {
    isBlocked: (options) =>
      !hasSupportedDirectPublicMediaExtension(options.objectKey),
    reason: "unsupported-extension",
    status: 404,
  },
  {
    isBlocked: isDocumentNavigation,
    reason: "document-navigation",
    status: 403,
  },
  {
    isBlocked: (options) => acceptsHtml(options.accept),
    reason: "html-accept",
    status: 403,
  },
] satisfies readonly DirectPublicMediaRequestBlockRule[];

/**
 * Derive the security policy for serving media objects directly from the
 * provider's public base URL. Requires a capability document declaring
 * `publication.directObjectPublication`,
 * `publication.manifestGatedPublication`, and
 * `delivery.documentNavigationCanBeBlocked`, plus an `https` public base
 * URL; throws otherwise. The policy pins the allowed media origin and
 * extensions (`.m4s`, `.mp4`), forbids `set-cookie`, and bundles cache
 * policies for manifests, media objects, and negative objects.
 */
export function createDirectPublicSecurityPolicy(
  options: CreateDirectPublicSecurityPolicyOptions
): DirectPublicSecurityPolicy {
  assertProviderCapabilityDocument(options.capability);
  assertDirectPublicCapability(options.capability);

  const origin = publicBaseOrigin(options.capability.delivery.publicBaseUrl);
  const targetLatencySeconds = options.targetLatencySeconds ?? 3;

  return {
    allowedMediaOrigins: [origin],
    allowedMediaExtensions: DIRECT_PUBLIC_MEDIA_EXTENSIONS,
    forbiddenResponseHeaders: ["set-cookie"],
    manifestCachePolicy: createDeliveryCachePolicy({
      maxAgeSeconds: options.manifestMaxAgeSeconds,
      target: "manifest",
      targetLatencySeconds,
    }),
    mediaObjectCachePolicy: createDeliveryCachePolicy({
      capability: options.capability,
      target: "media-object",
    }),
    mediaResponseHeaders: DIRECT_PUBLIC_MEDIA_RESPONSE_HEADERS,
    negativeObjectCachePolicy: createDeliveryCachePolicy({
      capability: options.capability,
      target: "negative-object",
      targetLatencySeconds,
    }),
  };
}

/**
 * Evaluate a direct-public media request against the block rules, in
 * order, first match wins: 404 when the object key is unsafe or lacks a
 * supported media extension (`.m4s`/`.mp4`); 403 when the request is a
 * document navigation (`Sec-Fetch-Dest: document` or
 * `Sec-Fetch-Mode: navigate`) or accepts `text/html`. Pure.
 */
export function resolveDirectPublicMediaRequestPolicy(
  options: ResolveDirectPublicMediaRequestPolicyOptions
): DirectPublicMediaRequestPolicy {
  for (const rule of DIRECT_PUBLIC_MEDIA_REQUEST_BLOCK_RULES) {
    if (rule.isBlocked(options)) {
      return directPublicMediaRequestBlocked(rule);
    }
  }

  return { allowed: true };
}

function directPublicMediaRequestBlocked(
  rule: DirectPublicMediaRequestBlockRule
): DirectPublicMediaRequestPolicy {
  return {
    allowed: false,
    reason: rule.reason,
    status: rule.status,
  };
}

function hasSupportedDirectPublicMediaExtension(objectKey: string): boolean {
  const lowerObjectKey = objectKey.toLowerCase();

  return DIRECT_PUBLIC_MEDIA_EXTENSIONS.some((extension) =>
    lowerObjectKey.endsWith(extension)
  );
}

function isDocumentNavigation(
  options: ResolveDirectPublicMediaRequestPolicyOptions
): boolean {
  return (
    options.fetchDestination === "document" || options.fetchMode === "navigate"
  );
}

function acceptsHtml(accept: string | null | undefined): boolean {
  return accept?.toLowerCase().includes("text/html") === true;
}

/**
 * Build the response headers for serving a direct-public media object:
 * the policy's fixed media headers plus `cache-control` from the
 * media-object cache policy and a `content-type` of `video/mp4`. Throws
 * when the object key would be blocked by
 * {@link resolveDirectPublicMediaRequestPolicy}.
 */
export function createDirectPublicMediaResponseHeaders(
  options: CreateDirectPublicMediaResponseHeadersOptions
): Record<string, string> {
  return {
    ...options.policy.mediaResponseHeaders,
    "cache-control": options.policy.mediaObjectCachePolicy.cacheControl,
    "content-type": contentTypeForDirectPublicMediaObject(options.objectKey),
  };
}

/**
 * Build the response headers for a negative (not-yet-uploaded) object
 * response: the policy's fixed media headers plus `cache-control` from
 * the negative-object cache policy. No `content-type` is set. Throws when
 * the object key would be blocked by
 * {@link resolveDirectPublicMediaRequestPolicy}.
 */
export function createDirectPublicNegativeObjectResponseHeaders(
  options: CreateDirectPublicNegativeObjectResponseHeadersOptions
): Record<string, string> {
  assertSupportedDirectPublicMediaObject(options.objectKey);

  return {
    ...options.policy.mediaResponseHeaders,
    "cache-control": options.policy.negativeObjectCachePolicy.cacheControl,
  };
}

function assertDirectPublicCapability(
  capability: ProviderCapabilityDocument
): void {
  for (const requirement of DIRECT_PUBLIC_CAPABILITY_REQUIREMENTS) {
    assertDirectPublicCapabilityRequirement(capability, requirement);
  }
}

function assertDirectPublicCapabilityRequirement(
  capability: ProviderCapabilityDocument,
  requirement: DirectPublicCapabilityRequirement
): void {
  if (!requirement.isSupported(capability)) {
    throw new Error(requirement.message);
  }
}

function publicBaseOrigin(publicBaseUrl: string): string {
  const url = new URL(publicBaseUrl);

  if (url.protocol !== "https:") {
    throw new Error(
      "providerCapability.delivery.publicBaseUrl must use https for direct-public security"
    );
  }

  return url.origin;
}

function assertSupportedDirectPublicMediaObject(objectKey: string): void {
  const policy = resolveDirectPublicMediaRequestPolicy({ objectKey });

  if (!policy.allowed) {
    throw new Error(
      `objectKey is blocked by direct-public policy: ${policy.reason}`
    );
  }
}

function contentTypeForDirectPublicMediaObject(objectKey: string): string {
  assertSupportedDirectPublicMediaObject(objectKey);
  return "video/mp4";
}

const DIRECT_PUBLIC_MEDIA_EXTENSIONS = [".m4s", ".mp4"] as const;

const DIRECT_PUBLIC_MEDIA_RESPONSE_HEADERS = {
  "access-control-allow-credentials": "false",
  "cross-origin-resource-policy": "same-site",
  "x-content-type-options": "nosniff",
} as const;
