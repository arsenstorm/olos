import type {
  CreateHlsManifestArtifactResponseOptions,
  CreateHlsManifestArtifactsOptions,
} from "../hls/manifest-artifacts";
import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "../validation/ids";
import { optionalField } from "./optional-field";
import type {
  RuntimePublisherObjectKindDefaults,
  RuntimePublisherPlannedObjectDefaults,
} from "./publisher-cadence";
import { positiveNumber } from "./request-fields";

export interface RuntimeObjectLowLatencyProfile {
  blockingReloadTimeoutMs: number;
  cursorMaxAgeMs: number;
  latencyProfile: "object-ll";
  manifestMaxAgeSeconds: number;
  minUploadTtlSeconds: number;
  partHoldBack: number;
  partTarget: number;
  publisherLeaseTtlMs: number;
  segmentTarget: number;
  targetLatency: number;
}

export interface RuntimeObjectLowLatencyManifestOptions {
  blockingReloadTimeoutMs: number;
  manifest: Pick<
    CreateHlsManifestArtifactsOptions,
    "partHoldBack" | "partTarget" | "segmentTarget" | "targetLatency"
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

export interface CreateRuntimeObjectLowLatencyPublisherDefaultsOptions {
  contentType: string;
  init: RuntimeObjectLowLatencyPublisherInitOptions;
  part: RuntimeObjectLowLatencyPublisherObjectOptions;
  profile?: RuntimeObjectLowLatencyProfile;
  segment: RuntimeObjectLowLatencyPublisherObjectOptions;
}

export interface RuntimeObjectLowLatencyPublisherInitOptions
  extends RuntimeObjectLowLatencyPublisherObjectOptions {
  duration: number;
}

export interface RuntimeObjectLowLatencyPublisherObjectOptions {
  extension?: string;
  maxBytes: number;
  minBytes?: number;
}

export function createRuntimeObjectLowLatencyProfile(): RuntimeObjectLowLatencyProfile {
  return {
    blockingReloadTimeoutMs: 3000,
    cursorMaxAgeMs: 5000,
    latencyProfile: "object-ll",
    manifestMaxAgeSeconds: 1,
    minUploadTtlSeconds: 1,
    partHoldBack: 3,
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
      partHoldBack: profile.partHoldBack,
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

export function createRuntimeObjectLowLatencyPublisherDefaults(
  options: CreateRuntimeObjectLowLatencyPublisherDefaultsOptions
): RuntimePublisherPlannedObjectDefaults {
  const profile = options.profile ?? createRuntimeObjectLowLatencyProfile();

  return {
    init: publisherObjectDefaults({
      contentType: options.contentType,
      duration: options.init.duration,
      extension: options.init.extension ?? "mp4",
      object: options.init,
    }),
    part: publisherObjectDefaults({
      contentType: options.contentType,
      duration: profile.partTarget,
      extension: options.part.extension ?? "m4s",
      object: options.part,
    }),
    segment: publisherObjectDefaults({
      contentType: options.contentType,
      duration: profile.segmentTarget,
      extension: options.segment.extension ?? "m4s",
      object: options.segment,
    }),
  };
}

function publisherObjectDefaults(options: {
  contentType: string;
  duration: number;
  extension: string;
  object: RuntimeObjectLowLatencyPublisherObjectOptions;
}): RuntimePublisherObjectKindDefaults {
  if (options.contentType.length === 0) {
    throw new Error("contentType must be a non-empty string");
  }

  positiveNumber(options.duration, "duration");

  if (!isPositiveSafeInteger(options.object.maxBytes)) {
    throw new Error("maxBytes must be a positive integer");
  }

  if (
    options.object.minBytes !== undefined &&
    (!isNonNegativeSafeInteger(options.object.minBytes) ||
      options.object.minBytes > options.object.maxBytes)
  ) {
    throw new Error("minBytes must be a non-negative integer up to maxBytes");
  }

  return {
    contentType: options.contentType,
    duration: options.duration,
    extension: options.extension,
    maxBytes: options.object.maxBytes,
    ...optionalField("minBytes", options.object.minBytes),
  };
}
