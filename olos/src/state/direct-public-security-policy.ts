import type { DirectPublicSecurityPolicy } from "../types/direct-public-security-policy";
import type { ProviderCapabilityDocument } from "../types/provider-capability";
import { assertProviderCapabilityDocument } from "../validation/provider-capability";
import { createDeliveryCachePolicy } from "./cache-policy";

export interface CreateDirectPublicSecurityPolicyOptions {
  capability: ProviderCapabilityDocument;
  manifestMaxAgeSeconds?: number;
  targetLatencySeconds?: number;
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
    manifestCachePolicy: createDeliveryCachePolicy({
      maxAgeSeconds: options.manifestMaxAgeSeconds,
      target: "manifest",
      targetLatencySeconds,
    }),
    mediaObjectCachePolicy: createDeliveryCachePolicy({
      capability: options.capability,
      target: "media-object",
    }),
    negativeObjectCachePolicy: createDeliveryCachePolicy({
      capability: options.capability,
      target: "negative-object",
      targetLatencySeconds,
    }),
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
