import type {
  CreateHlsManifestArtifactResponseOptions,
  CreateHlsManifestArtifactsOptions,
} from "../hls/manifest-artifacts";

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

export interface RuntimeObjectLowLatencyManifestOptions {
  blockingReloadTimeoutMs: number;
  manifest: Pick<
    CreateHlsManifestArtifactsOptions,
    "partTarget" | "segmentTarget" | "targetLatency"
  >;
  response: CreateHlsManifestArtifactResponseOptions;
}

export interface RuntimeObjectLowLatencyPublisherOptions {
  expiry: {
    minTtlSeconds: number;
    targetLatency: number;
  };
  publisherLeaseTtlMs: number;
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

export function createRuntimeObjectLowLatencyManifestOptions(
  profile: RuntimeObjectLowLatencyProfile = createRuntimeObjectLowLatencyProfile()
): RuntimeObjectLowLatencyManifestOptions {
  return {
    blockingReloadTimeoutMs: profile.blockingReloadTimeoutMs,
    manifest: {
      partTarget: profile.partTarget,
      segmentTarget: profile.segmentTarget,
      targetLatency: profile.targetLatency,
    },
    response: {
      maxAgeSeconds: profile.manifestMaxAgeSeconds,
      targetLatencySeconds: profile.targetLatency,
    },
  };
}

export function createRuntimeObjectLowLatencyPublisherOptions(
  profile: RuntimeObjectLowLatencyProfile = createRuntimeObjectLowLatencyProfile()
): RuntimeObjectLowLatencyPublisherOptions {
  return {
    expiry: {
      minTtlSeconds: profile.minUploadTtlSeconds,
      targetLatency: profile.targetLatency,
    },
    publisherLeaseTtlMs: profile.publisherLeaseTtlMs,
  };
}
