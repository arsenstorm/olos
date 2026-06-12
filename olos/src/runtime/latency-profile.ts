export interface RuntimeObjectLowLatencyProfile {
  blockingReloadTimeoutMs: number;
  cursorMaxAgeMs: number;
  latencyProfile: "object-ll";
  manifestMaxAgeSeconds: number;
  minUploadTtlSeconds: number;
  partTarget: number;
  publisherLeaseTtlMs: number;
  segmentTarget: number;
  targetLatency: number;
}

export function createRuntimeObjectLowLatencyProfile(): RuntimeObjectLowLatencyProfile {
  return {
    blockingReloadTimeoutMs: 3000,
    cursorMaxAgeMs: 5000,
    latencyProfile: "object-ll",
    manifestMaxAgeSeconds: 1,
    minUploadTtlSeconds: 1,
    partTarget: 0.5,
    publisherLeaseTtlMs: 3000,
    segmentTarget: 2,
    targetLatency: 3,
  };
}
