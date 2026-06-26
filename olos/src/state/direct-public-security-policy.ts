import type { DirectPublicSecurityPolicy } from "../types/direct-public-security-policy";
import type { ProviderCapabilityDocument } from "../types/provider-capability";
import { isSafeObjectKey } from "../validation/object-key";
import { assertProviderCapabilityDocument } from "../validation/provider-capability";
import { createDeliveryCachePolicy } from "./cache-policy";

export interface CreateDirectPublicSecurityPolicyOptions {
  capability: ProviderCapabilityDocument;
  manifestMaxAgeSeconds?: number;
  targetLatencySeconds?: number;
}

export type DirectPublicMediaRequestBlockReason =
  | "document-navigation"
  | "html-accept"
  | "unsafe-object-key"
  | "unsupported-extension";

export type DirectPublicMediaRequestPolicy =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: DirectPublicMediaRequestBlockReason;
      status: 403 | 404;
    };

export interface ResolveDirectPublicMediaRequestPolicyOptions {
  accept?: string | null;
  fetchDestination?: string | null;
  fetchMode?: string | null;
  objectKey: string;
}

export interface CreateDirectPublicMediaResponseHeadersOptions {
  objectKey: string;
  policy: DirectPublicSecurityPolicy;
}

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

export function createDirectPublicMediaResponseHeaders(
  options: CreateDirectPublicMediaResponseHeadersOptions
): Record<string, string> {
  return {
    ...options.policy.mediaResponseHeaders,
    "cache-control": options.policy.mediaObjectCachePolicy.cacheControl,
    "content-type": contentTypeForDirectPublicMediaObject(options.objectKey),
  };
}

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
