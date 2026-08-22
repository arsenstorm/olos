import type { DirectPublicSecurityPolicy } from "../types/direct-public-security-policy";
import type { ProviderCapabilityDocument } from "../types/provider-capability";
import { assertContentType } from "../validation/content-type";
import { isSafeObjectKey } from "../validation/object-key";
import { assertProviderCapabilityDocument } from "../validation/provider-capability";
import { createDeliveryCachePolicy } from "./cache-policy";
import { assertPublicationModeCapability } from "./publication";

/** Options for {@link createDirectPublicSecurityPolicy}. */
export interface CreateDirectPublicSecurityPolicyOptions {
  /**
   * Object file extensions (with leading dot, lower-case) the policy
   * serves. Supplied by the media profile, e.g. `[".m4s", ".mp4"]` for
   * CMAF/LL-HLS.
   */
  allowedObjectExtensions: readonly string[];
  capability: ProviderCapabilityDocument;
  /** Max age in seconds for the manifest cache policy (default 1). */
  manifestMaxAgeSeconds?: number;
  /**
   * Content type stamped on every served object. Supplied by the media
   * profile, e.g. `video/mp4` for CMAF/LL-HLS.
   */
  objectContentType: string;
  /**
   * Latency budget in seconds bounding the manifest and negative-object
   * cache policies (default 3).
   */
  targetLatencySeconds?: number;
}

/** Reason a direct-public media request must be blocked. */
export type DirectPublicObjectRequestBlockReason =
  | "document-navigation"
  | "html-accept"
  | "unsafe-object-key"
  | "unsupported-extension";

/**
 * Verdict from {@link resolveDirectPublicObjectRequestPolicy}: either the
 * request may be served, or it must be answered with the given HTTP
 * status (404 for unsafe or unsupported object keys, 403 for document
 * navigations and HTML requests).
 */
export type DirectPublicObjectRequestPolicy =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: DirectPublicObjectRequestBlockReason;
      status: 403 | 404;
    };

/** Options for {@link resolveDirectPublicObjectRequestPolicy}. */
export interface ResolveDirectPublicObjectRequestPolicyOptions {
  /** `Accept` request header; requests accepting `text/html` are blocked. */
  accept?: string | null;
  /**
   * Object file extensions (with leading dot) that may be served. Supplied
   * by the media profile.
   */
  allowedObjectExtensions: readonly string[];
  /** `Sec-Fetch-Dest` request header; `document` requests are blocked. */
  fetchDestination?: string | null;
  /** `Sec-Fetch-Mode` request header; `navigate` requests are blocked. */
  fetchMode?: string | null;
  objectKey: string;
}

/** Options for {@link createDirectPublicObjectResponseHeaders}. */
export interface CreateDirectPublicObjectResponseHeadersOptions {
  objectKey: string;
  policy: DirectPublicSecurityPolicy;
}

/** Options for {@link createDirectPublicNegativeObjectResponseHeaders}. */
export interface CreateDirectPublicNegativeObjectResponseHeadersOptions {
  objectKey: string;
  policy: DirectPublicSecurityPolicy;
}

interface DirectPublicObjectRequestBlockRule {
  isBlocked: (
    options: ResolveDirectPublicObjectRequestPolicyOptions
  ) => boolean;
  reason: DirectPublicObjectRequestBlockReason;
  status: 403 | 404;
}

const DIRECT_PUBLIC_OBJECT_REQUEST_BLOCK_RULES = [
  {
    isBlocked: (options) => !isSafeObjectKey(options.objectKey),
    reason: "unsafe-object-key",
    status: 404,
  },
  {
    isBlocked: (options) =>
      !hasSupportedObjectExtension(
        options.objectKey,
        options.allowedObjectExtensions
      ),
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
] satisfies readonly DirectPublicObjectRequestBlockRule[];

/**
 * Derive the security policy for serving media objects directly from the
 * provider's public base URL. Requires a capability document declaring
 * `publication.directObjectPublication`,
 * `publication.manifestGatedPublication`, and
 * `delivery.documentNavigationCanBeBlocked`, plus an `https` public base
 * URL; throws otherwise. The policy pins the allowed delivery origin and
 * the caller-supplied `allowedObjectExtensions`/`objectContentType`,
 * forbids `set-cookie`, and bundles cache policies for manifests, media
 * objects, and negative objects.
 */
export function createDirectPublicSecurityPolicy(
  options: CreateDirectPublicSecurityPolicyOptions
): DirectPublicSecurityPolicy {
  assertProviderCapabilityDocument(options.capability);
  assertPublicationModeCapability(
    options.capability,
    "direct-public",
    "security"
  );
  assertAllowedObjectExtensions(options.allowedObjectExtensions);
  assertContentType(options.objectContentType, "objectContentType");

  const origin = publicBaseOrigin(options.capability.delivery.publicBaseUrl);
  const targetLatencySeconds = options.targetLatencySeconds ?? 3;

  return {
    allowedDeliveryOrigins: [origin],
    allowedObjectExtensions: options.allowedObjectExtensions,
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
    objectContentType: options.objectContentType,
    objectResponseHeaders: DIRECT_PUBLIC_OBJECT_RESPONSE_HEADERS,
    negativeObjectCachePolicy: createDeliveryCachePolicy({
      capability: options.capability,
      target: "negative-object",
      targetLatencySeconds,
    }),
  };
}

/**
 * Evaluate a direct-public media request against the block rules, in
 * order, first match wins: 404 when the object key is unsafe or lacks an
 * extension in `options.allowedObjectExtensions`; 403 when the request is
 * a document navigation (`Sec-Fetch-Dest: document` or
 * `Sec-Fetch-Mode: navigate`) or accepts `text/html`. Pure.
 */
export function resolveDirectPublicObjectRequestPolicy(
  options: ResolveDirectPublicObjectRequestPolicyOptions
): DirectPublicObjectRequestPolicy {
  for (const rule of DIRECT_PUBLIC_OBJECT_REQUEST_BLOCK_RULES) {
    if (rule.isBlocked(options)) {
      return directPublicMediaRequestBlocked(rule);
    }
  }

  return { allowed: true };
}

function directPublicMediaRequestBlocked(
  rule: DirectPublicObjectRequestBlockRule
): DirectPublicObjectRequestPolicy {
  return {
    allowed: false,
    reason: rule.reason,
    status: rule.status,
  };
}

function hasSupportedObjectExtension(
  objectKey: string,
  allowedObjectExtensions: readonly string[]
): boolean {
  const lowerObjectKey = objectKey.toLowerCase();

  return allowedObjectExtensions.some((extension) =>
    lowerObjectKey.endsWith(extension)
  );
}

function isDocumentNavigation(
  options: ResolveDirectPublicObjectRequestPolicyOptions
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
 * the policy's fixed object headers plus `cache-control` from the
 * media-object cache policy and the policy's `content-type`. Throws when
 * the object key would be blocked by
 * {@link resolveDirectPublicObjectRequestPolicy}.
 */
export function createDirectPublicObjectResponseHeaders(
  options: CreateDirectPublicObjectResponseHeadersOptions
): Record<string, string> {
  assertSupportedDirectPublicObject(
    options.objectKey,
    options.policy.allowedObjectExtensions
  );

  return {
    ...options.policy.objectResponseHeaders,
    "cache-control": options.policy.mediaObjectCachePolicy.cacheControl,
    "content-type": options.policy.objectContentType,
  };
}

/**
 * Build the response headers for a negative (not-yet-uploaded) object
 * response: the policy's fixed object headers plus `cache-control` from
 * the negative-object cache policy. No `content-type` is set. Throws when
 * the object key would be blocked by
 * {@link resolveDirectPublicObjectRequestPolicy}.
 */
export function createDirectPublicNegativeObjectResponseHeaders(
  options: CreateDirectPublicNegativeObjectResponseHeadersOptions
): Record<string, string> {
  assertSupportedDirectPublicObject(
    options.objectKey,
    options.policy.allowedObjectExtensions
  );

  return {
    ...options.policy.objectResponseHeaders,
    "cache-control": options.policy.negativeObjectCachePolicy.cacheControl,
  };
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

function assertAllowedObjectExtensions(
  allowedObjectExtensions: readonly string[]
): void {
  const isValid =
    allowedObjectExtensions.length > 0 &&
    allowedObjectExtensions.every(
      (extension) =>
        extension.length > 0 &&
        extension.startsWith(".") &&
        extension === extension.toLowerCase()
    );

  if (!isValid) {
    throw new Error(
      "allowedObjectExtensions must be a non-empty list of lower-case extensions starting with '.'"
    );
  }
}

function assertSupportedDirectPublicObject(
  objectKey: string,
  allowedObjectExtensions: readonly string[]
): void {
  const policy = resolveDirectPublicObjectRequestPolicy({
    allowedObjectExtensions,
    objectKey,
  });

  if (!policy.allowed) {
    throw new Error(
      `objectKey is blocked by direct-public policy: ${policy.reason}`
    );
  }
}

const DIRECT_PUBLIC_OBJECT_RESPONSE_HEADERS = {
  "access-control-allow-credentials": "false",
  "cross-origin-resource-policy": "same-site",
  "x-content-type-options": "nosniff",
} as const;
