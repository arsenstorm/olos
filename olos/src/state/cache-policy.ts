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

const DEFAULT_FRESHNESS_BOUND_MAX_AGE_SECONDS = 1;
const DEFAULT_MEDIA_OBJECT_MAX_AGE_SECONDS = 31_536_000;
const DEFAULT_TARGET_LATENCY_SECONDS = 3;
const FRESHNESS_BOUND_CACHE_DIRECTIVE = "must-revalidate";
const IMMUTABLE_CACHE_DIRECTIVE = "immutable";

export interface CreateDeliveryCachePolicyOptions {
  capability?: ProviderCapabilityDocument;
  maxAgeSeconds?: number;
  target: DeliveryCacheTarget;
  targetLatencySeconds?: number;
}

export function createDeliveryCachePolicy(
  options: CreateDeliveryCachePolicyOptions
): DeliveryCachePolicy {
  assertOptionalProviderCapability(options.capability);

  if (isMediaObjectCacheTarget(options.target)) {
    return createMediaObjectCachePolicy(options);
  }

  return createFreshnessBoundCachePolicy(options);
}

function assertOptionalProviderCapability(
  capability: ProviderCapabilityDocument | undefined
): void {
  if (capability !== undefined) {
    assertProviderCapabilityDocument(capability);
  }
}

function createMediaObjectCachePolicy(
  options: CreateDeliveryCachePolicyOptions
): DeliveryCachePolicy {
  assertImmutableCachingSupport(options.capability);

  const maxAgeSeconds =
    options.maxAgeSeconds ?? DEFAULT_MEDIA_OBJECT_MAX_AGE_SECONDS;
  assertPositiveInteger(maxAgeSeconds, "maxAgeSeconds");

  return {
    cacheControl: formatPublicCacheControl(
      maxAgeSeconds,
      IMMUTABLE_CACHE_DIRECTIVE
    ),
    maxAgeSeconds,
    target: "media-object",
  };
}

function createFreshnessBoundCachePolicy(
  options: CreateDeliveryCachePolicyOptions
): DeliveryCachePolicy {
  const targetLatencySeconds =
    options.targetLatencySeconds ?? DEFAULT_TARGET_LATENCY_SECONDS;
  const maxAgeSeconds =
    options.maxAgeSeconds ?? DEFAULT_FRESHNESS_BOUND_MAX_AGE_SECONDS;

  assertFreshnessBound(maxAgeSeconds, targetLatencySeconds);
  assertNegativeCachingPolicySupport(options);

  return {
    cacheControl: formatPublicCacheControl(
      maxAgeSeconds,
      FRESHNESS_BOUND_CACHE_DIRECTIVE
    ),
    maxAgeSeconds,
    target: options.target,
  };
}

function isMediaObjectCacheTarget(target: DeliveryCacheTarget): boolean {
  return target === "media-object";
}

function formatPublicCacheControl(
  maxAgeSeconds: number,
  directive: string
): string {
  return `public, max-age=${maxAgeSeconds}, ${directive}`;
}

function assertImmutableCachingSupport(
  capability: ProviderCapabilityDocument | undefined
): void {
  if (capability?.delivery.immutableCaching !== true) {
    throw new Error(
      "providerCapability.delivery.immutableCaching must be true for media-object cache policies"
    );
  }
}

function assertFreshnessBound(
  maxAgeSeconds: number,
  targetLatencySeconds: number
): void {
  assertPositiveInteger(targetLatencySeconds, "targetLatencySeconds");
  assertNonNegativeInteger(maxAgeSeconds, "maxAgeSeconds");

  if (maxAgeSeconds > targetLatencySeconds) {
    throw new Error(
      "maxAgeSeconds must be less than or equal to targetLatencySeconds"
    );
  }
}

function assertNegativeCachingPolicySupport(
  options: CreateDeliveryCachePolicyOptions
): void {
  if (
    options.target === "negative-object" &&
    options.capability?.delivery.negativeCachingPolicyDeclared !== true
  ) {
    throw new Error(
      "providerCapability.delivery.negativeCachingPolicyDeclared must be true for negative-object cache policies"
    );
  }
}
