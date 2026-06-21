import type {
  DeliveryCachePolicy,
  DeliveryCacheTarget,
} from "../types/cache-policy";
import type { ProviderCapabilityDocument } from "../types/provider-capability";
import {
  assertNonNegativeInteger,
  assertPositiveInteger,
} from "../validation/ids";
import { assertProviderCapabilityDocument } from "../validation/provider-capability";

export interface CreateDeliveryCachePolicyOptions {
  capability?: ProviderCapabilityDocument;
  maxAgeSeconds?: number;
  target: DeliveryCacheTarget;
  targetLatencySeconds?: number;
}

export function createDeliveryCachePolicy(
  options: CreateDeliveryCachePolicyOptions
): DeliveryCachePolicy {
  if (options.capability !== undefined) {
    assertProviderCapabilityDocument(options.capability);
  }

  if (options.target === "media-object") {
    return createMediaObjectCachePolicy(options);
  }

  return createFreshnessBoundCachePolicy(options);
}

function createMediaObjectCachePolicy(
  options: CreateDeliveryCachePolicyOptions
): DeliveryCachePolicy {
  if (options.capability?.delivery.immutableCaching !== true) {
    throw new Error(
      "providerCapability.delivery.immutableCaching must be true for media-object cache policies"
    );
  }

  const maxAgeSeconds = options.maxAgeSeconds ?? 31_536_000;
  assertPositiveInteger(maxAgeSeconds, "maxAgeSeconds");

  return {
    cacheControl: `public, max-age=${maxAgeSeconds}, immutable`,
    maxAgeSeconds,
    target: "media-object",
  };
}

function createFreshnessBoundCachePolicy(
  options: CreateDeliveryCachePolicyOptions
): DeliveryCachePolicy {
  const targetLatencySeconds = options.targetLatencySeconds ?? 3;
  assertPositiveInteger(targetLatencySeconds, "targetLatencySeconds");

  const maxAgeSeconds = options.maxAgeSeconds ?? 1;
  assertNonNegativeInteger(maxAgeSeconds, "maxAgeSeconds");

  if (maxAgeSeconds > targetLatencySeconds) {
    throw new Error(
      "maxAgeSeconds must be less than or equal to targetLatencySeconds"
    );
  }

  if (
    options.target === "negative-object" &&
    options.capability?.delivery.negativeCachingPolicyDeclared !== true
  ) {
    throw new Error(
      "providerCapability.delivery.negativeCachingPolicyDeclared must be true for negative-object cache policies"
    );
  }

  return {
    cacheControl: `public, max-age=${maxAgeSeconds}, must-revalidate`,
    maxAgeSeconds,
    target: options.target,
  };
}
