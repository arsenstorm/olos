import { DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE } from "./latency-profile";
import { positiveNumber, timestampMs } from "./request-fields";

const DEFAULT_MIN_TTL_SECONDS =
  DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE.minUploadTtlSeconds;
const MILLISECONDS_PER_SECOND = 1000;

export interface ResolveRuntimePublisherObjectExpiryOptions {
  duration: number;
  minTtlSeconds?: number;
  now: Date | string;
  targetLatency: number;
}

export interface RuntimePublisherObjectExpiry {
  expiresAt: string;
  ttlSeconds: number;
}

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
  const duration = positiveNumber(options.duration, "duration");
  const targetLatency = positiveNumber(options.targetLatency, "targetLatency");
  const minTtlSeconds = positiveNumber(
    options.minTtlSeconds ?? DEFAULT_MIN_TTL_SECONDS,
    "minTtlSeconds"
  );

  return Math.max(minTtlSeconds, Math.ceil(duration + targetLatency));
}

function runtimePublisherObjectExpiresAt(
  now: Date | string,
  ttlSeconds: number
): string {
  const nowMs = timestampMs(now, "now");

  return new Date(nowMs + ttlSeconds * MILLISECONDS_PER_SECOND).toISOString();
}
