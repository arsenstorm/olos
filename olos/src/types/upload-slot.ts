import type { Byterange } from "./byterange";
import type { Epoch, OlosId, PartNumber, SequenceNumber } from "./ids";
import type { ProfileData } from "./profile";
import type { PUBLICATION_MODES } from "./publication";
import type { ObjectKind } from "./storage-object";

/**
 * Upload slot lifecycle states, from `issued` through `upload_observed` to
 * `committed`, with `expired`, `rejected`, and `revoked` as failure exits.
 * `UploadSlotState` (olos/types) is the derived union type.
 */
export const UPLOAD_SLOT_STATES = [
  "issued",
  "upload_observed",
  "committed",
  "expired",
  "rejected",
  "revoked",
] as const;

/**
 * Allowed upload slot state transitions, keyed by current state. States
 * absent from the map (`expired`, `rejected`, `revoked`) are terminal.
 * Enforced by `canTransitionUploadSlot` / `assertUploadSlotTransition`
 * (olos/state).
 */
export const UPLOAD_SLOT_TRANSITIONS = {
  committed: ["revoked"],
  issued: ["upload_observed", "expired", "revoked"],
  upload_observed: ["committed", "rejected", "revoked"],
} as const;

/** How committed objects become publicly readable for a provider. */
export type PublicationMode = (typeof PUBLICATION_MODES)[number];
/** Upload slot lifecycle state; see `UPLOAD_SLOT_STATES` (olos/types). */
export type UploadSlotState = (typeof UPLOAD_SLOT_STATES)[number];

/**
 * A coordinator-issued reservation for exactly one object upload: it pins
 * the object key, content type, size bounds, and deadline that the eventual
 * upload must match before it can be committed. Validated by
 * `assertUploadSlot` (olos/validation).
 */
export interface UploadSlot {
  /** Only valid on part slots; positions the part in a virtual segment. */
  byterange?: Byterange;
  contentType: string;
  deliveryUrl: string;
  epoch: Epoch;
  /** ISO 8601 deadline; uploads observed after it are rejected as late. */
  expiresAt: string;
  kind: ObjectKind;
  /** Largest accepted upload size in bytes. */
  maxBytes: number;
  /** Smallest accepted upload size in bytes. No minimum when absent. */
  minBytes?: number;
  objectKey: string;
  /** Present on `part` slots; absent on segment and init slots. */
  partNumber?: PartNumber;
  /** Profile-defined expectations for the object (opaque to Core). */
  profile?: ProfileData;
  sequenceNumber: SequenceNumber;
  sessionId: OlosId;
  slotId: OlosId;
  state: UploadSlotState;
  trackId: OlosId;
}
