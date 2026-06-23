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
import { timestampMs } from "./timestamp";

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

type IssuedUploadSlot = UploadSlot & { state: "issued" };
type ObservedUploadSlot = UploadSlot & { state: "upload_observed" };

interface TerminalUploadTransitionOptions<
  TStatus extends string,
  TAlreadyStatus extends string,
> {
  alreadyStatus: TAlreadyStatus;
  slot: UploadSlot;
  status: TStatus;
  targetState: UploadSlotState;
  validate?: () => void;
}

interface TerminalUploadTransitionResult<
  TStatus extends string,
  TAlreadyStatus extends string,
> {
  slot: UploadSlot;
  status: TStatus | TAlreadyStatus;
}

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
    publicationMode: options.publicationMode,
    publisherInstanceId: options.publisherInstanceId,
    renditionId: options.renditionId,
    sessionId: options.session.sessionId,
    slotId: options.slotId,
    state: "issued",
    tenantId: options.session.tenantId,
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
): Pick<UploadSlot, "minBytes" | "partNumber"> {
  const optionalFields: Pick<UploadSlot, "minBytes" | "partNumber"> = {};

  if (options.minBytes !== undefined) {
    optionalFields.minBytes = options.minBytes;
  }

  if (options.partNumber !== undefined) {
    optionalFields.partNumber = options.partNumber;
  }

  return optionalFields;
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
    status: isObservedUploadSlot(options.slot)
      ? "already_observed"
      : "observed",
  };

  if (options.cursor !== undefined) {
    result.cursor = options.cursor;
  }

  if (isIssuedUploadSlot(options.slot)) {
    assertUploadSlotTransition(options.slot.state, "upload_observed");
  }

  return result;
}

function isIssuedUploadSlot(slot: UploadSlot): slot is IssuedUploadSlot {
  return slot.state === "issued";
}

function isObservedUploadSlot(slot: UploadSlot): slot is ObservedUploadSlot {
  return slot.state === "upload_observed";
}

export function expireUpload(options: ResolveUploadExpiryOptions): UploadSlot {
  return resolveUploadExpiry(options).slot;
}

export function resolveUploadExpiry(
  options: ResolveUploadExpiryOptions
): UploadExpiryResult {
  return resolveTerminalUploadTransition({
    alreadyStatus: "already_expired",
    slot: options.slot,
    status: "expired",
    targetState: "expired",
    validate: () => assertUploadExpiryReady(options),
  });
}

function assertUploadExpiryReady(options: ResolveUploadExpiryOptions): void {
  if (
    timestampMs(options.now, "now") <
    timestampMs(options.slot.expiresAt, "uploadSlot.expiresAt")
  ) {
    throw new Error("now must be after or equal to uploadSlot.expiresAt");
  }
}

export function rejectUpload(
  options: ResolveUploadRejectionOptions
): UploadSlot {
  return resolveUploadRejection(options).slot;
}

export function resolveUploadRejection(
  options: ResolveUploadRejectionOptions
): UploadRejectionResult {
  return resolveTerminalUploadTransition({
    alreadyStatus: "already_rejected",
    slot: options.slot,
    status: "rejected",
    targetState: "rejected",
  });
}

export function revokeUpload(
  options: ResolveUploadRevocationOptions
): UploadSlot {
  return resolveUploadRevocation(options).slot;
}

export function resolveUploadRevocation(
  options: ResolveUploadRevocationOptions
): UploadRevocationResult {
  return resolveTerminalUploadTransition({
    alreadyStatus: "already_revoked",
    slot: options.slot,
    status: "revoked",
    targetState: "revoked",
  });
}

function resolveTerminalUploadTransition<
  TStatus extends string,
  TAlreadyStatus extends string,
>(
  options: TerminalUploadTransitionOptions<TStatus, TAlreadyStatus>
): TerminalUploadTransitionResult<TStatus, TAlreadyStatus> {
  assertUploadSlot(options.slot);

  if (options.slot.state === options.targetState) {
    return {
      slot: options.slot,
      status: options.alreadyStatus,
    };
  }

  assertUploadSlotTransition(options.slot.state, options.targetState);
  options.validate?.();

  return {
    slot: {
      ...options.slot,
      state: options.targetState,
    },
    status: options.status,
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
