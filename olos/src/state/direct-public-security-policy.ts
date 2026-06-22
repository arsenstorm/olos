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
  if (!isSafeObjectKey(options.objectKey)) {
    return {
      allowed: false,
      reason: "unsafe-object-key",
      status: 404,
    };
  }

  if (!hasSupportedDirectPublicMediaExtension(options.objectKey)) {
    return {
      allowed: false,
      reason: "unsupported-extension",
      status: 404,
    };
  }

  if (isDocumentNavigation(options)) {
    return {
      allowed: false,
      reason: "document-navigation",
      status: 403,
    };
  }

  if (acceptsHtml(options.accept)) {
    return {
      allowed: false,
      reason: "html-accept",
      status: 403,
    };
  }

  return { allowed: true };
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
  if (capability.publication.directObjectPublication !== true) {
    throw new Error(
      "providerCapability.publication.directObjectPublication must be true for direct-public security"
    );
  }

  if (capability.publication.manifestGatedPublication !== true) {
    throw new Error(
      "providerCapability.publication.manifestGatedPublication must be true for direct-public security"
    );
  }

  if (capability.delivery.documentNavigationCanBeBlocked !== true) {
    throw new Error(
      "providerCapability.delivery.documentNavigationCanBeBlocked must be true for direct-public security"
    );
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
