import type {
  CreateHlsManifestArtifactResponseOptions,
  CreateHlsManifestArtifactsOptions,
} from "../hls/manifest-artifacts";
import { positiveNumber } from "../validation/fields";
import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "../validation/ids";
import {
  DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE,
  type RuntimeObjectLowLatencyProfile,
} from "./latency-profile-defaults";
import type {
  RuntimePublisherObjectKindDefaults,
  RuntimePublisherPlannedObjectDefaults,
} from "./publisher-cadence";
import { optionalField } from "./request-fields";

/**
 * Manifest-serving settings derived from a low-latency profile, shaped for
 * the coordinator manifest helpers.
 */
export interface RuntimeObjectLowLatencyManifestOptions {
  /** Max time a blocking playlist reload is held open, in ms. */
  blockingReloadTimeoutMs: number;
  /** Playlist rendering options (durations and hold-backs, in seconds). */
  manifest: Pick<
    CreateHlsManifestArtifactsOptions,
    "partHoldBack" | "partTarget" | "segmentTarget" | "targetLatency"
  >;
  /** Cache policy for playlist responses. */
  response: CreateHlsManifestArtifactResponseOptions;
}

/**
 * Publisher-side settings derived from a low-latency profile: slot expiry
 * inputs and the heartbeat lease TTL.
 */
export interface RuntimeObjectLowLatencyPublisherOptions {
  /** Inputs for `resolveRuntimePublisherObjectExpiry` (both in seconds). */
  expiry: {
    minTtlSeconds: number;
    targetLatency: number;
  };
  /** Publisher lease TTL to request per heartbeat, in ms. */
  publisherLeaseTtlMs: number;
}

/** Options for `createRuntimeObjectLowLatencyPublisherDefaults`. */
export interface CreateRuntimeObjectLowLatencyPublisherDefaultsOptions {
  /** Content type applied to init, part, and segment objects alike. */
  contentType: string;
  init: RuntimeObjectLowLatencyPublisherInitOptions;
  part: RuntimeObjectLowLatencyPublisherObjectOptions;
  /** Profile supplying part/segment durations; defaults to the object-ll one. */
  profile?: RuntimeObjectLowLatencyProfile;
  segment: RuntimeObjectLowLatencyPublisherObjectOptions;
}

/**
 * Init-object options. Unlike parts and segments, whose durations come from
 * the profile, the init object's `duration` must be given explicitly, in
 * seconds.
 */
export interface RuntimeObjectLowLatencyPublisherInitOptions
  extends RuntimeObjectLowLatencyPublisherObjectOptions {
  duration: number;
}

/** Per-object-kind byte bounds and file extension for publisher defaults. */
export interface RuntimeObjectLowLatencyPublisherObjectOptions {
  /** File extension override; defaults to `mp4` for init, `m4s` otherwise. */
  extension?: string;
  maxBytes: number;
  /** Lower byte bound; must not exceed `maxBytes`. */
  minBytes?: number;
}

/**
 * Return a fresh mutable copy of the default object-based low-latency
 * profile (0.5 s parts, 2 s segments, 3 s target latency).
 */
export function createRuntimeObjectLowLatencyProfile(): RuntimeObjectLowLatencyProfile {
  return { ...DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE };
}

/**
 * Derive manifest-serving settings from a low-latency profile, defaulting
 * to `createRuntimeObjectLowLatencyProfile()`.
 */
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

/**
 * Derive publisher-side settings (slot expiry inputs and lease TTL) from a
 * low-latency profile, defaulting to `createRuntimeObjectLowLatencyProfile()`.
 */
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

/**
 * Build the per-kind planned-object defaults a publisher cadence needs:
 * part and segment durations come from the profile, the init duration from
 * `options.init`, and byte bounds/extensions from the per-kind options.
 * Throws on empty content types, non-positive durations, or byte bounds
 * where `minBytes` exceeds `maxBytes`.
 */
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
  assertPublisherObjectContentType(options.contentType);
  assertPublisherObjectDuration(options.duration);
  assertPublisherObjectByteBounds(options.object);

  return {
    contentType: options.contentType,
    duration: options.duration,
    extension: options.extension,
    maxBytes: options.object.maxBytes,
    ...optionalField("minBytes", options.object.minBytes),
  };
}

function assertPublisherObjectContentType(contentType: string): void {
  if (contentType.length === 0) {
    throw new Error("contentType must be a non-empty string");
  }
}

function assertPublisherObjectDuration(duration: number): void {
  positiveNumber(duration, "duration");
}

function assertPublisherObjectByteBounds(
  object: RuntimeObjectLowLatencyPublisherObjectOptions
): void {
  assertPublisherObjectMaxBytes(object.maxBytes);
  assertPublisherObjectMinBytes(object);
}

function assertPublisherObjectMaxBytes(maxBytes: number): void {
  if (!isPositiveSafeInteger(maxBytes)) {
    throw new Error("maxBytes must be a positive integer");
  }
}

function assertPublisherObjectMinBytes(
  object: RuntimeObjectLowLatencyPublisherObjectOptions
): void {
  if (
    object.minBytes !== undefined &&
    (!isNonNegativeSafeInteger(object.minBytes) ||
      object.minBytes > object.maxBytes)
  ) {
    throw new Error("minBytes must be a non-negative integer up to maxBytes");
  }
}
