import { UPLOAD_SLOT_TRANSITIONS } from "../config/upload-slot";
import type { Cursor } from "../types/cursor";
import type { MediaObjectKind } from "../types/media-object";
import type { Session } from "../types/session";
import type { UploadSlot, UploadSlotState } from "../types/upload-slot";
import {
  assertObservedUploadMatchesSlot,
  type ObservedUpload,
} from "../validation/observed-upload";
import { assertSession } from "../validation/session";
import { assertUploadSlot } from "../validation/upload-slot";

export interface CreateIssuedUploadSlotOptions {
  contentType: string;
  deliveryUrl: string;
  duration: number;
  expiresAt: string;
  kind: MediaObjectKind;
  maxBytes: number;
  mediaSequenceNumber: number;
  minBytes?: number;
  objectKey: string;
  partNumber?: number;
  publicationMode: UploadSlot["publicationMode"];
  publisherInstanceId: string;
  renditionId: string;
  session: Session;
  slotId: string;
}

export interface ObserveUploadOptions {
  cursor?: Cursor;
  lateToleranceMs?: number;
  object: ObservedUpload;
  slot: UploadSlot;
}

export interface UploadObservationResult {
  cursor?: Cursor;
  cursorAdvanced: false;
  slot: UploadSlot;
  status: "already_observed" | "observed";
}

export interface ResolveUploadExpiryOptions {
  now: string;
  slot: UploadSlot;
}

export interface UploadExpiryResult {
  slot: UploadSlot;
  status: "already_expired" | "expired";
}

export interface ResolveUploadRejectionOptions {
  slot: UploadSlot;
}

export interface UploadRejectionResult {
  slot: UploadSlot;
  status: "already_rejected" | "rejected";
}

export interface ResolveUploadRevocationOptions {
  slot: UploadSlot;
}

export interface UploadRevocationResult {
  slot: UploadSlot;
  status: "already_revoked" | "revoked";
}

export function createIssuedUploadSlot(
  options: CreateIssuedUploadSlotOptions
): UploadSlot {
  assertSession(options.session);

  if (options.session.state !== "live") {
    throw new Error("session.state must be live");
  }

  if (
    !options.session.renditions.some(
      (rendition) => rendition.renditionId === options.renditionId
    )
  ) {
    throw new Error("uploadSlot.renditionId must belong to session.renditions");
  }

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
    publicationMode: options.publicationMode,
    publisherInstanceId: options.publisherInstanceId,
    renditionId: options.renditionId,
    sessionId: options.session.sessionId,
    slotId: options.slotId,
    state: "issued",
    tenantId: options.session.tenantId,
  };

  if (options.minBytes !== undefined) {
    slot.minBytes = options.minBytes;
  }

  if (options.partNumber !== undefined) {
    slot.partNumber = options.partNumber;
  }

  assertUploadSlot(slot);

  return slot;
}

export function observeUpload(options: ObserveUploadOptions): UploadSlot {
  return resolveUploadObservation(options).slot;
}

export function resolveUploadObservation(
  options: ObserveUploadOptions
): UploadObservationResult {
  assertObservedUploadMatchesSlot(options);

  const result: UploadObservationResult = {
    cursorAdvanced: false,
    slot: {
      ...options.slot,
      state: "upload_observed",
    },
    status:
      options.slot.state === "upload_observed"
        ? "already_observed"
        : "observed",
  };

  if (options.cursor !== undefined) {
    result.cursor = options.cursor;
  }

  if (options.slot.state === "issued") {
    assertUploadSlotTransition(options.slot.state, "upload_observed");
  }

  return result;
}

export function expireUpload(options: ResolveUploadExpiryOptions): UploadSlot {
  return resolveUploadExpiry(options).slot;
}

export function resolveUploadExpiry(
  options: ResolveUploadExpiryOptions
): UploadExpiryResult {
  assertUploadSlot(options.slot);

  if (options.slot.state === "expired") {
    return {
      slot: options.slot,
      status: "already_expired",
    };
  }

  assertUploadSlotTransition(options.slot.state, "expired");

  if (
    timestampMs(options.now, "now") <
    timestampMs(options.slot.expiresAt, "uploadSlot.expiresAt")
  ) {
    throw new Error("now must be after or equal to uploadSlot.expiresAt");
  }

  return {
    slot: {
      ...options.slot,
      state: "expired",
    },
    status: "expired",
  };
}

export function rejectUpload(
  options: ResolveUploadRejectionOptions
): UploadSlot {
  return resolveUploadRejection(options).slot;
}

export function resolveUploadRejection(
  options: ResolveUploadRejectionOptions
): UploadRejectionResult {
  assertUploadSlot(options.slot);

  if (options.slot.state === "rejected") {
    return {
      slot: options.slot,
      status: "already_rejected",
    };
  }

  assertUploadSlotTransition(options.slot.state, "rejected");

  return {
    slot: {
      ...options.slot,
      state: "rejected",
    },
    status: "rejected",
  };
}

export function revokeUpload(
  options: ResolveUploadRevocationOptions
): UploadSlot {
  return resolveUploadRevocation(options).slot;
}

export function resolveUploadRevocation(
  options: ResolveUploadRevocationOptions
): UploadRevocationResult {
  assertUploadSlot(options.slot);

  if (options.slot.state === "revoked") {
    return {
      slot: options.slot,
      status: "already_revoked",
    };
  }

  assertUploadSlotTransition(options.slot.state, "revoked");

  return {
    slot: {
      ...options.slot,
      state: "revoked",
    },
    status: "revoked",
  };
}

export function canTransitionUploadSlot(
  from: UploadSlotState,
  to: UploadSlotState
): boolean {
  return allowedUploadSlotTransitions(from).includes(to);
}

export function assertUploadSlotTransition(
  from: UploadSlotState,
  to: UploadSlotState
): void {
  if (canTransitionUploadSlot(from, to)) {
    return;
  }

  throw new Error(`Invalid upload slot transition: ${from} -> ${to}`);
}

function allowedUploadSlotTransitions(
  from: UploadSlotState
): readonly UploadSlotState[] {
  const transitions: Partial<
    Record<UploadSlotState, readonly UploadSlotState[]>
  > = UPLOAD_SLOT_TRANSITIONS;

  return transitions[from] ?? [];
}

function timestampMs(value: string, name: string): number {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    throw new Error(`${name} must be a valid timestamp`);
  }

  return timestamp;
}
