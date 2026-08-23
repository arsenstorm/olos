import type { Commit } from "../types/commit";
import { createOlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import { assertCommit } from "../validation/commit";
import { assertObservedUpload } from "../validation/observed-upload";
import { assertUploadSlot } from "../validation/upload-slot";
import {
  assertCommitPreconditions,
  isLateSlot,
  resolveObjectSlotMismatch,
} from "./commit-mismatch";
import type {
  CommitAttemptOptionsWithSlot,
  CommitAttemptRejection,
  CommitAttemptResolution,
  CommitObservedUploadOptions,
  CommitObservedUploadResult,
  CreateCommitOptions,
  ResolveCommitAttemptOptions,
  ResolveUploadCommitOptions,
  UploadCommitResolution,
} from "./commit-types";
import { trackWindowBounds } from "./committed-window";
import { mergeProfileData } from "./profile-data";
import {
  assertUploadSlotTransition,
  observeUpload,
} from "./upload-slot-observe";
/**
 * Build the immutable {@link Commit} record for an observed upload. Pure —
 * the slot is not modified; use {@link resolveUploadCommit} to also advance
 * the slot to `committed`. Throws when the slot is not `upload_observed`,
 * the object's key or content type does not match the slot, the size is
 * outside the slot's `minBytes`/`maxBytes` bounds, or `committedAt` is
 * later than `slot.expiresAt + lateToleranceMs`.
 */
export function createCommit(options: CreateCommitOptions): Commit {
  assertUploadSlot(options.slot);
  // Observed-upload validation: commit evidence may carry the provider
  // `metadata` map, which the closed wire `StorageObject` validator rejects.
  assertObservedUpload(options.mediaObject);
  assertCommitPreconditions(options);

  const profile = mergeProfileData(options.slot.profile, options.profile);
  const commit: Commit = {
    ...(options.slot.byterange === undefined
      ? {}
      : { byterange: options.slot.byterange }),
    commitId: options.commitId,
    committedAt: options.committedAt,
    deliveryUrl: options.slot.deliveryUrl,
    epoch: options.slot.epoch,
    ...(options.mediaObject.etag === undefined
      ? {}
      : { etag: options.mediaObject.etag }),
    objectKey: options.slot.objectKey,
    sequenceNumber: options.slot.sequenceNumber,
    ...(options.slot.partNumber === undefined
      ? {}
      : { partNumber: options.slot.partNumber }),
    ...(profile === undefined ? {} : { profile }),
    sessionId: options.slot.sessionId,
    size: options.mediaObject.size,
    slotId: options.slot.slotId,
    trackId: options.slot.trackId,
  };

  assertCommit(commit);
  return commit;
}

/**
 * Observe an upload and commit it in one step: advances the slot to
 * `upload_observed` (via {@link observeUpload}) and then to `committed`
 * (via {@link resolveUploadCommit}). Pure — returns new slot copies.
 * Throws when the observed object does not match the slot or a commit
 * precondition fails.
 */
export function commitObservedUpload(
  options: CommitObservedUploadOptions
): CommitObservedUploadResult {
  const slot = observeUpload({
    lateToleranceMs: options.lateToleranceMs,
    object: options.object,
    slot: options.slot,
  });

  return resolveUploadCommit({
    commitId: options.commitId,
    committedAt: options.committedAt,
    lateToleranceMs: options.lateToleranceMs,
    mediaObject: options.object,
    profile: options.profile,
    slot,
  });
}

/**
 * Commit an observed upload: builds the {@link Commit} via
 * {@link createCommit} and returns a copy of the slot advanced to the
 * `committed` state. Pure; throws when a commit precondition fails or the
 * slot cannot transition to `committed`.
 */
export function resolveUploadCommit(
  options: ResolveUploadCommitOptions
): UploadCommitResolution {
  const commit = createCommit(options);

  assertUploadSlotTransition(options.slot.state, "committed");

  return {
    commit,
    slot: {
      ...options.slot,
      state: "committed",
    },
  };
}

/**
 * Resolve a full commit attempt without throwing on protocol-level
 * failures. Returns `committed` with the commit and updated slot on
 * success; otherwise a rejection: `unknown_slot` (no `slot` supplied),
 * `invalid_state` (session is aborted), `unverified_object`
 * (`objectVerified` not set), `late_object` (slot position at or behind
 * the cursor), or `key_mismatch` / `content_type_mismatch` /
 * `object_too_large` / `object_too_small` (object does not satisfy the
 * slot's constraints). Pure; still throws on structurally invalid inputs.
 */
export function resolveCommitAttempt(
  options: ResolveCommitAttemptOptions
): CommitAttemptResolution {
  const slot = options.slot;

  if (slot === undefined) {
    return unknownSlotCommitAttempt(options.slotId);
  }

  const precondition = resolveCommitAttemptPrecondition({
    ...options,
    slot,
  });

  if (precondition !== undefined) {
    return precondition;
  }

  const mismatch = resolveObjectSlotMismatch({
    includeKeyMismatch: true,
    mediaObject: options.mediaObject,
    slot,
  });

  if (mismatch !== undefined) {
    return mismatch;
  }

  return committedCommitAttempt(options, slot);
}

function committedCommitAttempt(
  options: ResolveCommitAttemptOptions,
  slot: NonNullable<ResolveCommitAttemptOptions["slot"]>
): CommitAttemptResolution {
  const result = resolveUploadCommit({
    commitId: options.commitId,
    committedAt: options.committedAt,
    lateToleranceMs: options.lateToleranceMs,
    mediaObject: options.mediaObject,
    profile: options.profile,
    slot,
  });

  return {
    ...result,
    status: "committed",
  };
}

function unknownSlotCommitAttempt(slotId: OlosId): CommitAttemptRejection {
  return {
    error: createOlosError("olos.unknown_slot", "upload slot is unknown", {
      slotId,
    }),
    status: "unknown_slot",
  };
}

function resolveCommitAttemptPrecondition(
  options: CommitAttemptOptionsWithSlot
): CommitAttemptRejection | undefined {
  if (options.session?.state === "aborted") {
    return abortedSessionCommitAttempt(options);
  }

  if (options.objectVerified !== true) {
    return unverifiedObjectCommitAttempt(options);
  }

  if (
    options.cursor !== undefined &&
    isLateSlot(options.slot, options.cursor)
  ) {
    return lateObjectCommitAttempt(options);
  }
}

function abortedSessionCommitAttempt(
  options: CommitAttemptOptionsWithSlot
): CommitAttemptRejection {
  return {
    error: createOlosError("olos.invalid_state", "session is aborted", {
      sessionId: options.session?.sessionId,
      slotId: options.slot.slotId,
      state: options.session?.state,
    }),
    status: "invalid_state",
  };
}

function unverifiedObjectCommitAttempt(
  options: CommitAttemptOptionsWithSlot
): CommitAttemptRejection {
  return {
    error: createOlosError(
      "olos.invalid_state",
      "object existence is unverified",
      {
        objectKey: options.mediaObject.objectKey,
        slotId: options.slot.slotId,
      }
    ),
    status: "unverified_object",
  };
}

function lateObjectCommitAttempt(
  options: CommitAttemptOptionsWithSlot
): CommitAttemptRejection {
  const edge =
    options.cursor === undefined
      ? undefined
      : trackWindowBounds(options.cursor.committedWindow, options.slot.trackId);

  return {
    error: createOlosError(
      "olos.invalid_state",
      "object is behind the current cursor",
      {
        partNumber: options.slot.partNumber,
        sequenceNumber: options.slot.sequenceNumber,
        slotId: options.slot.slotId,
        trackLastPartNumber: edge?.lastPartNumber,
        trackLastSequenceNumber: edge?.lastSequenceNumber,
      }
    ),
    status: "late_object",
  };
}
