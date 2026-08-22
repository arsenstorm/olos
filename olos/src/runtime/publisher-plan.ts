import { createPublisherObjectKey } from "../state/object-key-derivation";
import type { ProfileData } from "../types/profile";
import { PUBLICATION_MODES } from "../types/publication";
import type { ObjectKind } from "../types/storage-object";
import type { PublicationMode } from "../types/upload-slot";
import { positiveNumber } from "../validation/fields";
import {
  assertUrlSafeIdentifier,
  isNonNegativeInteger,
} from "../validation/ids";
import { assertProfileData } from "../validation/profile";
import { assertSafePath, assertSafePathSegment } from "./path";
import { optionalField, timestampMs } from "./request-fields";
import type { RuntimeSlotIssuePayload } from "./slot";

// The wire payload (`slot`) carries no objectKey or deliveryUrl; the
// coordinator chooses them server-side. The preview only lets a publisher
// that supplies its own nonce predict the eventual address before issuance.

/** Options for `createRuntimePublisherObjectPlan`. */
export interface CreateRuntimePublisherObjectPlanOptions {
  /** Prefix for the derived commit id; defaults to `commit`. */
  commitIdPrefix?: string;
  contentType: string;
  /** Slot expiry as an ISO 8601 timestamp. */
  expiresAt: string;
  /** File extension used in the object key; omitted for none. */
  extension?: string;
  kind: RuntimePublisherPlannedObjectKind;
  maxBytes: number;
  /** Lower byte bound; must not exceed `maxBytes`. */
  minBytes?: number;
  /**
   * Nonce mixed into the derived object key. Required when
   * `publicationMode` is `direct-public` (the default) so public object
   * addresses are unguessable.
   */
  objectKeyNonce?: string;
  objectKeyPrefix?: string;
  /** Zero-based part index; required for parts, forbidden otherwise. */
  partNumber?: number;
  /** Profile data carried on the slot (opaque to Core). */
  profile?: ProfileData;
  /** Defaults to `direct-public`. */
  publicationMode?: PublicationMode;
  sequenceNumber: number;
  /** Prefix for the derived slot id; defaults to `slot`. */
  slotIdPrefix?: string;
  trackId: string;
}

/** Object kinds a publisher can plan: `init`, `part`, or `segment`. */
export type RuntimePublisherPlannedObjectKind = Extract<
  ObjectKind,
  "init" | "part" | "segment"
>;

/**
 * Result of `createRuntimePublisherObjectPlan`: the slot issue payload plus
 * the deterministic commit id and a client-side preview of the object key
 * the coordinator will derive.
 */
export interface RuntimePublisherObjectPlan {
  commitId: string;
  /**
   * Predicted object key. The wire payload never carries it — the
   * coordinator derives the authoritative key at issuance.
   */
  objectKey: string;
  slot: RuntimeSlotIssuePayload;
}

type InitPublisherObjectPlanOptions =
  CreateRuntimePublisherObjectPlanOptions & {
    kind: "init";
  };
type PartPublisherObjectPlanOptions =
  CreateRuntimePublisherObjectPlanOptions & {
    kind: "part";
  };
type SegmentPublisherObjectPlanOptions =
  CreateRuntimePublisherObjectPlanOptions & {
    kind: "segment";
  };

/**
 * Build the slot issue payload for a planned object along with a
 * deterministic commit id and an object key preview. Ids are derived from
 * the track and timeline position (e.g. `slot_video_s12_p3`), so
 * retrying the same position reuses the same ids and commits stay
 * idempotent. Validates identifiers, timeline fields, byte bounds, and the
 * nonce policy, throwing on any violation.
 */
export function createRuntimePublisherObjectPlan(
  options: CreateRuntimePublisherObjectPlanOptions
): RuntimePublisherObjectPlan {
  assertPlanOptions(options);

  const slotId = createObjectId(options, options.slotIdPrefix ?? "slot");
  const objectKey = createPublisherObjectKey(options);

  return {
    commitId: createObjectId(options, options.commitIdPrefix ?? "commit"),
    objectKey,
    slot: {
      contentType: options.contentType,
      expiresAt: options.expiresAt,
      kind: options.kind,
      maxBytes: options.maxBytes,
      sequenceNumber: options.sequenceNumber,
      trackId: options.trackId,
      slotId,
      ...optionalField("extension", options.extension),
      ...optionalField("minBytes", options.minBytes),
      ...optionalField("objectKeyNonce", options.objectKeyNonce),
      ...optionalField("objectKeyPrefix", options.objectKeyPrefix),
      ...optionalField("partNumber", options.partNumber),
      ...optionalField("profile", options.profile),
    },
  };
}

function assertPlanOptions(
  options: CreateRuntimePublisherObjectPlanOptions
): void {
  assertUrlSafeIdentifier(options.trackId, "trackId");
  assertUrlSafeIdentifier(options.slotIdPrefix ?? "slot", "slotIdPrefix");
  assertUrlSafeIdentifier(options.commitIdPrefix ?? "commit", "commitIdPrefix");
  assertOptionalUrlSafeIdentifier(options.objectKeyNonce, "objectKeyNonce");
  assertPublicationNoncePolicy(options);

  if (options.objectKeyPrefix !== undefined) {
    assertSafePath(options.objectKeyPrefix, "objectKeyPrefix");
  }

  if (options.extension !== undefined) {
    assertSafePathSegment(options.extension, "extension");
  }

  if (options.profile !== undefined) {
    assertProfileData(options.profile, "profile");
  }

  assertPlanPartNumber(options);

  if (!isNonNegativeInteger(options.sequenceNumber)) {
    throw new Error("sequenceNumber must be a non-negative integer");
  }

  timestampMs(options.expiresAt, "expiresAt");

  assertPlanByteBounds(options);
}

function assertPlanPartNumber(
  options: CreateRuntimePublisherObjectPlanOptions
): void {
  if (isPartPublisherObjectPlan(options)) {
    if (!isNonNegativeInteger(options.partNumber)) {
      throw new Error("partNumber must be a non-negative integer for parts");
    }
  } else if (options.partNumber !== undefined) {
    throw new Error("partNumber is only valid for parts");
  }
}

function assertPlanByteBounds(
  options: CreateRuntimePublisherObjectPlanOptions
): void {
  positiveNumber(options.maxBytes, "maxBytes");

  if (
    options.minBytes !== undefined &&
    (!isNonNegativeInteger(options.minBytes) ||
      options.minBytes > options.maxBytes)
  ) {
    throw new Error("minBytes must be a non-negative integer up to maxBytes");
  }
}

function assertPublicationMode(value: PublicationMode): void {
  if (!PUBLICATION_MODES.includes(value)) {
    throw new Error(
      `publicationMode must be one of: ${PUBLICATION_MODES.join(", ")}`
    );
  }
}

function assertPublicationNoncePolicy(
  options: CreateRuntimePublisherObjectPlanOptions
): void {
  const publicationMode = options.publicationMode ?? "direct-public";

  assertPublicationMode(publicationMode);

  if (
    publicationMode === "direct-public" &&
    options.objectKeyNonce === undefined
  ) {
    throw new Error(
      "objectKeyNonce is required for direct-public object plans"
    );
  }
}

function createObjectId(
  options: CreateRuntimePublisherObjectPlanOptions,
  prefix: string
): string {
  if (isInitPublisherObjectPlan(options)) {
    return `${prefix}_init_${options.trackId}`;
  }

  if (isSegmentPublisherObjectPlan(options)) {
    return `${prefix}_${options.trackId}_s${options.sequenceNumber}`;
  }

  return `${prefix}_${options.trackId}_s${options.sequenceNumber}_p${options.partNumber}`;
}

function isInitPublisherObjectPlan(
  options: CreateRuntimePublisherObjectPlanOptions
): options is InitPublisherObjectPlanOptions {
  return options.kind === "init";
}

function isPartPublisherObjectPlan(
  options: CreateRuntimePublisherObjectPlanOptions
): options is PartPublisherObjectPlanOptions {
  return options.kind === "part";
}

function isSegmentPublisherObjectPlan(
  options: CreateRuntimePublisherObjectPlanOptions
): options is SegmentPublisherObjectPlanOptions {
  return options.kind === "segment";
}

function assertOptionalUrlSafeIdentifier(
  value: string | undefined,
  name: string
): void {
  if (value !== undefined) {
    assertUrlSafeIdentifier(value, name);
  }
}
