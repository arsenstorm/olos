import {
  DEFAULT_MAX_HEALTH_CURSOR_AGE_MS,
  DEFAULT_PUBLISHER_LEASE_TTL_MS,
  DEFAULT_TARGET_LATENCY,
} from "../runtime/http-types";

/**
 * Tuning knobs for the object-based low-latency HLS profile: one coherent
 * set of timings shared by manifest serving, publisher pacing, and health
 * checks so they all assume the same cadence.
 */
export interface RuntimeObjectLowLatencyProfile {
  /** Max time a blocking playlist reload is held open, in ms. */
  blockingReloadTimeoutMs: number;
  /** Cursor age at which session health reports stale, in ms. */
  cursorMaxAgeMs: number;
  /** `max-age` for playlist responses, in seconds. */
  manifestMaxAgeSeconds: number;
  /** Floor for issued upload slot TTLs, in seconds. */
  minUploadTtlSeconds: number;
  /** HLS `PART-HOLD-BACK`, in seconds. */
  partHoldBack: number;
  /** Partial segment duration, in seconds. */
  partTarget: number;
  /** Publisher lease TTL granted per heartbeat, in ms. */
  publisherLeaseTtlMs: number;
  /** Full segment duration, in seconds. */
  segmentTarget: number;
  /** End-to-end target latency, in seconds. */
  targetLatency: number;
}

export const DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE: Readonly<RuntimeObjectLowLatencyProfile> =
  {
    blockingReloadTimeoutMs: 3000,
    cursorMaxAgeMs: DEFAULT_MAX_HEALTH_CURSOR_AGE_MS,
    manifestMaxAgeSeconds: 1,
    minUploadTtlSeconds: 1,
    partHoldBack: 3,
    partTarget: 0.5,
    publisherLeaseTtlMs: DEFAULT_PUBLISHER_LEASE_TTL_MS,
    segmentTarget: 2,
    targetLatency: DEFAULT_TARGET_LATENCY,
  };
