const DEFAULT_MIN_TTL_SECONDS = 1;
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
  const duration = positiveNumber(options.duration, "duration");
  const targetLatency = positiveNumber(options.targetLatency, "targetLatency");
  const minTtlSeconds = positiveNumber(
    options.minTtlSeconds ?? DEFAULT_MIN_TTL_SECONDS,
    "minTtlSeconds"
  );
  const ttlSeconds = Math.max(
    minTtlSeconds,
    Math.ceil(duration + targetLatency)
  );
  const nowMs = timestampMs(options.now);

  return {
    expiresAt: new Date(
      nowMs + ttlSeconds * MILLISECONDS_PER_SECOND
    ).toISOString(),
    ttlSeconds,
  };
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return value;
}

function timestampMs(value: Date | string): number {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);

  if (Number.isNaN(timestamp)) {
    throw new Error("now must be a valid timestamp");
  }

  return timestamp;
}
