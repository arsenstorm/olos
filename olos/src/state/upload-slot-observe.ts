import type { UploadSlot, UploadSlotState } from "../types/upload-slot";
import { timestampMs } from "../validation/fields";
import { assertObservedUploadMatchesSlot } from "../validation/observed-upload";
import { assertUploadSlot } from "../validation/upload-slot";
import {
  type IssuedUploadSlot,
  type ObservedUploadSlot,
  type ObserveUploadOptions,
  type ResolveUploadExpiryOptions,
  type ResolveUploadRejectionOptions,
  type ResolveUploadRevocationOptions,
  type TerminalUploadTransitionOptions,
  type TerminalUploadTransitionResult,
  UPLOAD_SLOT_TRANSITION_MAP,
  type UploadExpiryResult,
  type UploadObservationResult,
  type UploadRejectionResult,
  type UploadRevocationResult,
} from "./upload-slot";
/**
 * Shorthand for {@link resolveUploadObservation} that returns only the
 * updated slot.
 */
export function observeUpload(options: ObserveUploadOptions): UploadSlot {
  return resolveUploadObservation(options).slot;
}

/**
 * Record provider evidence that the slot's object exists, moving an
 * `issued` slot to `upload_observed`. Idempotent: observing an
 * already-observed slot returns `already_observed` with an equivalent
 * copy. Pure. Throws when the slot is in any other state or the observed
 * object does not match the slot (key, content type, size bounds, or an
 * observation later than `slot.expiresAt + lateToleranceMs`).
 * `cursorAdvanced` is always false — only commits advance the cursor.
 */
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

/**
 * Shorthand for {@link resolveUploadExpiry} that returns only the updated
 * slot.
 */
export function expireUpload(options: ResolveUploadExpiryOptions): UploadSlot {
  return resolveUploadExpiry(options).slot;
}

/**
 * Move an `issued` slot to `expired` once its deadline has passed.
 * Idempotent: an already-expired slot returns `already_expired`
 * unchanged. Pure. Throws when `now` precedes `slot.expiresAt` or when
 * the slot is in any other state — observed and committed slots cannot
 * expire.
 */
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

/**
 * Shorthand for {@link resolveUploadRejection} that returns only the
 * updated slot.
 */
export function rejectUpload(
  options: ResolveUploadRejectionOptions
): UploadSlot {
  return resolveUploadRejection(options).slot;
}

/**
 * Move an `upload_observed` slot to `rejected` (its object failed commit
 * checks). Idempotent: an already-rejected slot returns
 * `already_rejected` unchanged. Pure; throws for any other state — only
 * observed uploads can be rejected.
 */
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

/**
 * Shorthand for {@link resolveUploadRevocation} that returns only the
 * updated slot.
 */
export function revokeUpload(
  options: ResolveUploadRevocationOptions
): UploadSlot {
  return resolveUploadRevocation(options).slot;
}

/**
 * Move a slot to `revoked` by operator or policy action. Allowed from
 * `issued`, `upload_observed`, and `committed`. Idempotent: an
 * already-revoked slot returns `already_revoked` unchanged. Pure; throws
 * for `expired` and `rejected` slots, which are terminal.
 */
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

/**
 * Whether an upload slot may move from one state to another. Allowed
 * transitions: `issued -> upload_observed | expired | revoked`,
 * `upload_observed -> committed | rejected | revoked`, and
 * `committed -> revoked`; `expired`, `rejected`, and `revoked` are
 * terminal. Pure.
 */
export function canTransitionUploadSlot(
  from: UploadSlotState,
  to: UploadSlotState
): boolean {
  return allowedUploadSlotTransitions(from).includes(to);
}

/**
 * Throwing variant of {@link canTransitionUploadSlot}: throws
 * `Invalid upload slot transition: <from> -> <to>` when the transition is
 * not allowed, returns nothing otherwise.
 */
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
  return UPLOAD_SLOT_TRANSITION_MAP[from] ?? [];
}
