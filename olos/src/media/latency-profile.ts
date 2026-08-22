import type {
  CreateHlsManifestArtifactResponseOptions,
  CreateHlsManifestArtifactsOptions,
} from "../hls/manifest-artifact-types";
import {
  DEFAULT_MAX_HEALTH_CURSOR_AGE_MS,
  DEFAULT_PUBLISHER_LEASE_TTL_MS,
  DEFAULT_TARGET_LATENCY,
} from "../runtime/http-types";
import type {
  RuntimePublisherObjectKindDefaults,
  RuntimePublisherPlannedObjectDefaults,
} from "../runtime/publisher-cadence";
import { optionalField } from "../runtime/request-fields";
import type { ObjectKind } from "../types/storage-object";
import { positiveNumber } from "../validation/fields";
import { isNonNegativeInteger, isPositiveInteger } from "../validation/ids";
import {
  assertSupportedMediaExtension,
  DEFAULT_MEDIA_OBJECT_EXTENSIONS,
} from "./object-key";

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
 * Build the per-kind planned-object defaults a publisher cadence needs for
 * the CMAF/LL-HLS profile: part and segment durations come from the
 * profile, the init duration from `options.init`, and byte bounds and
 * extensions (`mp4` for init, `m4s` otherwise) from the per-kind options.
 * Each kind's `cadenceSeconds` and slot `profile.duration` are set to that
 * duration. Throws on empty content types, non-positive durations,
 * unsupported media extensions, or byte bounds where `minBytes` exceeds
 * `maxBytes`.
 */
export function createRuntimeObjectLowLatencyPublisherDefaults(
  options: CreateRuntimeObjectLowLatencyPublisherDefaultsOptions
): RuntimePublisherPlannedObjectDefaults {
  const profile = options.profile ?? createRuntimeObjectLowLatencyProfile();

  return {
    init: publisherObjectDefaults({
      contentType: options.contentType,
      duration: options.init.duration,
      kind: "init",
      object: options.init,
    }),
    part: publisherObjectDefaults({
      contentType: options.contentType,
      duration: profile.partTarget,
      kind: "part",
      object: options.part,
    }),
    segment: publisherObjectDefaults({
      contentType: options.contentType,
      duration: profile.segmentTarget,
      kind: "segment",
      object: options.segment,
    }),
  };
}

function publisherObjectDefaults(options: {
  contentType: string;
  duration: number;
  kind: ObjectKind;
  object: RuntimeObjectLowLatencyPublisherObjectOptions;
}): RuntimePublisherObjectKindDefaults {
  const extension =
    options.object.extension ?? DEFAULT_MEDIA_OBJECT_EXTENSIONS[options.kind];

  if (options.contentType.length === 0) {
    throw new Error("contentType must be a non-empty string");
  }

  positiveNumber(options.duration, "duration");
  assertSupportedMediaExtension(extension, options.kind, "extension");
  assertPublisherObjectMaxBytes(options.object.maxBytes);
  assertPublisherObjectMinBytes(options.object);

  return {
    cadenceSeconds: options.duration,
    contentType: options.contentType,
    extension,
    maxBytes: options.object.maxBytes,
    profile: { duration: options.duration },
    ...optionalField("minBytes", options.object.minBytes),
  };
}

function assertPublisherObjectMaxBytes(maxBytes: number): void {
  if (!isPositiveInteger(maxBytes)) {
    throw new Error("maxBytes must be a positive integer");
  }
}

function assertPublisherObjectMinBytes(
  object: RuntimeObjectLowLatencyPublisherObjectOptions
): void {
  if (
    object.minBytes !== undefined &&
    (!isNonNegativeInteger(object.minBytes) ||
      object.minBytes > object.maxBytes)
  ) {
    throw new Error("minBytes must be a non-negative integer up to maxBytes");
  }
}
