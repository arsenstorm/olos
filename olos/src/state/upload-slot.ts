import { UPLOAD_SLOT_TRANSITIONS } from "../config/upload-slot";
import type { Byterange } from "../types/byterange";
import type { Cursor } from "../types/cursor";
import type { MediaObjectKind } from "../types/media-object";
import type { Session } from "../types/session";
import type { UploadSlot, UploadSlotState } from "../types/upload-slot";
import type { ObservedUpload } from "../validation/observed-upload";
import { assertSession } from "../validation/session";
import { assertUploadSlot } from "../validation/upload-slot";
import {
  expireUpload,
  observeUpload,
  rejectUpload,
  resolveUploadExpiry,
  resolveUploadObservation,
  resolveUploadRejection,
  resolveUploadRevocation,
  revokeUpload,
} from "./upload-slot-observe";

export const UPLOAD_SLOT_TRANSITION_MAP: Partial<
  Record<UploadSlotState, readonly UploadSlotState[]>
> = UPLOAD_SLOT_TRANSITIONS;

/** Options for {@link createIssuedUploadSlot}. */
export interface CreateIssuedUploadSlotOptions {
  byterange?: Byterange;
  contentType: string;
  deliveryUrl: string;
  /** Media duration of the expected object in seconds. */
  duration: number;
  /** ISO timestamp after which an unobserved slot may be expired. */
  expiresAt: string;
  kind: MediaObjectKind;
  /** Maximum accepted object size in bytes. */
  maxBytes: number;
  mediaSequenceNumber: number;
  /** Minimum accepted object size in bytes. */
  minBytes?: number;
  objectKey: string;
  partNumber?: number;
  renditionId: string;
  /** Owning session; must be `live` and contain `renditionId`. */
  session: Session;
  slotId: string;
}

/** Options for {@link resolveUploadObservation} and {@link observeUpload}. */
export interface ObserveUploadOptions {
  /** Current cursor, echoed back unchanged on the result. */
  cursor?: Cursor;
  /**
   * Grace period in milliseconds added to `slot.expiresAt` before an
   * observation is considered late (default 0).
   */
  lateToleranceMs?: number;
  /** Provider evidence that the object exists; must match the slot. */
  object: ObservedUpload;
  slot: UploadSlot;
}

/** Result of {@link resolveUploadObservation}. */
export interface UploadObservationResult {
  /** The input cursor, unchanged, when one was supplied. */
  cursor?: Cursor;
  /** Always false: observation never advances the cursor; only commits do. */
  cursorAdvanced: false;
  /** Copy of the slot in the `upload_observed` state. */
  slot: UploadSlot;
  /** `already_observed` when the slot had already been observed. */
  status: "already_observed" | "observed";
}

/** Options for {@link resolveUploadExpiry} and {@link expireUpload}. */
export interface ResolveUploadExpiryOptions {
  /** ISO timestamp used as "now"; must be at or after `slot.expiresAt`. */
  now: string;
  slot: UploadSlot;
}

/** Result of {@link resolveUploadExpiry}. */
export interface UploadExpiryResult {
  /** Copy of the slot in the `expired` state. */
  slot: UploadSlot;
  /** `already_expired` when the slot was already expired. */
  status: "already_expired" | "expired";
}

/** Options for {@link resolveUploadRejection} and {@link rejectUpload}. */
export interface ResolveUploadRejectionOptions {
  slot: UploadSlot;
}

/** Result of {@link resolveUploadRejection}. */
export interface UploadRejectionResult {
  /** Copy of the slot in the `rejected` state. */
  slot: UploadSlot;
  /** `already_rejected` when the slot was already rejected. */
  status: "already_rejected" | "rejected";
}

/** Options for {@link resolveUploadRevocation} and {@link revokeUpload}. */
export interface ResolveUploadRevocationOptions {
  slot: UploadSlot;
}

/** Result of {@link resolveUploadRevocation}. */
export interface UploadRevocationResult {
  /** Copy of the slot in the `revoked` state. */
  slot: UploadSlot;
  /** `already_revoked` when the slot was already revoked. */
  status: "already_revoked" | "revoked";
}

export type IssuedUploadSlot = UploadSlot & { state: "issued" };
export type ObservedUploadSlot = UploadSlot & { state: "upload_observed" };

export interface TerminalUploadTransitionOptions<
  TStatus extends string,
  TAlreadyStatus extends string,
> {
  alreadyStatus: TAlreadyStatus;
  slot: UploadSlot;
  status: TStatus;
  targetState: UploadSlotState;
  validate?: () => void;
}

export interface TerminalUploadTransitionResult<
  TStatus extends string,
  TAlreadyStatus extends string,
> {
  slot: UploadSlot;
  status: TStatus | TAlreadyStatus;
}

/**
 * Create a new upload slot in the `issued` state for a live session. The
 * slot's epoch and session ID are copied from the session. Pure; throws
 * when the session is not `live`, `renditionId` does not belong to the
 * session's renditions, or the resulting slot fails validation.
 */
export function createIssuedUploadSlot(
  options: CreateIssuedUploadSlotOptions
): UploadSlot {
  assertIssuedUploadSlotSession(options);

  const slot: UploadSlot = {
    contentType: options.contentType,
    deliveryUrl: options.deliveryUrl,
    duration: options.duration,
    epoch: options.session.epoch,
    expiresAt: options.expiresAt,
    kind: options.kind,
    maxBytes: options.maxBytes,
    mediaSequenceNumber: options.mediaSequenceNumber,
    objectKey: options.objectKey,
    renditionId: options.renditionId,
    sessionId: options.session.sessionId,
    slotId: options.slotId,
    state: "issued",
    ...optionalIssuedUploadSlotFields(options),
  };

  assertUploadSlot(slot);

  return slot;
}

function assertIssuedUploadSlotSession(
  options: CreateIssuedUploadSlotOptions
): void {
  assertSession(options.session);

  if (options.session.state !== "live") {
    throw new Error("session.state must be live");
  }

  if (!sessionHasRendition(options.session, options.renditionId)) {
    throw new Error("uploadSlot.renditionId must belong to session.renditions");
  }
}

function sessionHasRendition(session: Session, renditionId: string): boolean {
  return session.renditions.some(
    (rendition) => rendition.renditionId === renditionId
  );
}

function optionalIssuedUploadSlotFields(
  options: CreateIssuedUploadSlotOptions
): Pick<UploadSlot, "byterange" | "minBytes" | "partNumber"> {
  const optionalFields: Pick<
    UploadSlot,
    "byterange" | "minBytes" | "partNumber"
  > = {};

  if (options.minBytes !== undefined) {
    optionalFields.minBytes = options.minBytes;
  }

  if (options.partNumber !== undefined) {
    optionalFields.partNumber = options.partNumber;
  }

  if (options.byterange !== undefined) {
    optionalFields.byterange = options.byterange;
  }

  return optionalFields;
}
