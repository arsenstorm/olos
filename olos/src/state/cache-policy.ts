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

/** Options for {@link createDeliveryCachePolicy}. */
export interface CreateDeliveryCachePolicyOptions {
  /**
   * Provider capability document. Required for `media-object` targets
   * (must declare `delivery.immutableCaching`) and `negative-object`
   * targets (must declare `delivery.negativeCachingPolicyDeclared`).
   */
  capability?: ProviderCapabilityDocument;
  /**
   * Cache lifetime in seconds. Defaults to 31,536,000 (one year) for
   * `media-object` targets and 1 second otherwise. For non-media-object
   * targets it must not exceed `targetLatencySeconds`.
   */
  maxAgeSeconds?: number;
  target: DeliveryCacheTarget;
  /**
   * Latency budget in seconds that caps `maxAgeSeconds` for manifest and
   * negative-object policies (default 3). Ignored for `media-object`
   * targets.
   */
  targetLatencySeconds?: number;
}

/**
 * Build the `Cache-Control` policy for a delivery target. `media-object`
 * targets get long-lived immutable caching
 * (`public, max-age=<maxAge>, immutable`); manifest and negative-object
 * targets get a short freshness bound
 * (`public, max-age=<maxAge>, must-revalidate`) whose max age must not
 * exceed `targetLatencySeconds`. Pure; throws when the required provider
 * capabilities are missing or the freshness bound is violated.
 */
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
    isNegativeObjectCacheTarget(options.target) &&
    options.capability?.delivery.negativeCachingPolicyDeclared !== true
  ) {
    throw new Error(
      "providerCapability.delivery.negativeCachingPolicyDeclared must be true for negative-object cache policies"
    );
  }
}

function isNegativeObjectCacheTarget(target: DeliveryCacheTarget): boolean {
  return target === "negative-object";
}
