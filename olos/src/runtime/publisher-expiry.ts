import { positiveNumber } from "../validation/fields";
import { timestampMs } from "./request-fields";

/** Default TTL floor, in seconds. */
export const DEFAULT_PUBLISHER_OBJECT_MIN_TTL_SECONDS = 1;
const MILLISECONDS_PER_SECOND = 1000;

/** Options for `resolveRuntimePublisherObjectExpiry`. */
export interface ResolveRuntimePublisherObjectExpiryOptions {
  /** Seconds the planned object is expected to cover. */
  cadenceSeconds: number;
  /** Floor for the computed TTL, in seconds; defaults to 1. */
  minTtlSeconds?: number;
  /** Time the TTL counts from. */
  now: Date | string;
  /** Latency budget added on top of the cadence, in seconds. */
  targetLatency: number;
}

/** Result of `resolveRuntimePublisherObjectExpiry`. */
export interface RuntimePublisherObjectExpiry {
  /** Absolute expiry (`now` + `ttlSeconds`) as an ISO 8601 timestamp. */
  expiresAt: string;
  ttlSeconds: number;
}

interface RuntimePublisherObjectTtlInputs {
  cadenceSeconds: number;
  minTtlSeconds: number;
  targetLatency: number;
}

/**
 * Compute how long a planned object's upload slot should stay valid:
 * `ceil(cadenceSeconds + targetLatency)` seconds, but never less than
 * `minTtlSeconds` (default 1). Returns both the TTL and the absolute
 * `expiresAt` derived from `now`.
 */
export function resolveRuntimePublisherObjectExpiry(
  options: ResolveRuntimePublisherObjectExpiryOptions
): RuntimePublisherObjectExpiry {
  const ttlSeconds = resolveRuntimePublisherObjectTtlSeconds(options);

  return {
    expiresAt: runtimePublisherObjectExpiresAt(options.now, ttlSeconds),
    ttlSeconds,
  };
}

function resolveRuntimePublisherObjectTtlSeconds(
  options: ResolveRuntimePublisherObjectExpiryOptions
): number {
  const inputs = runtimePublisherObjectTtlInputs(options);

  return Math.max(
    inputs.minTtlSeconds,
    Math.ceil(inputs.cadenceSeconds + inputs.targetLatency)
  );
}

function runtimePublisherObjectTtlInputs(
  options: ResolveRuntimePublisherObjectExpiryOptions
): RuntimePublisherObjectTtlInputs {
  return {
    cadenceSeconds: positiveNumber(options.cadenceSeconds, "cadenceSeconds"),
    minTtlSeconds: positiveNumber(
      options.minTtlSeconds ?? DEFAULT_PUBLISHER_OBJECT_MIN_TTL_SECONDS,
      "minTtlSeconds"
    ),
    targetLatency: positiveNumber(options.targetLatency, "targetLatency"),
  };
}

function runtimePublisherObjectExpiresAt(
  now: Date | string,
  ttlSeconds: number
): string {
  const nowMs = timestampMs(now, "now");

  return new Date(nowMs + ttlSeconds * MILLISECONDS_PER_SECOND).toISOString();
}
