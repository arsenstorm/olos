import { createCommit, resolveCommitAttempt } from "../state/commit";
import {
  resolveDuplicateCommit,
  resolveObjectSlotMismatch,
} from "../state/commit-mismatch";
import { mergeProfileData } from "../state/profile-data";
import {
  type PublicationControlResolution,
  resolvePublicationControl,
} from "../state/publication-control";
import { observeUpload } from "../state/upload-slot-observe";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import { createOlosError, type OlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { UploadSlot } from "../types/upload-slot";
import { timestampMs } from "../validation/fields";
import type { ObservedUpload } from "../validation/observed-upload";
import { commitIntoState } from "./coordinator-commit-state";
import { findSlot } from "./coordinator-slot";
import type {
  CommitCoordinatorUploadOptions,
  CoordinatorCommitPolicyDecision,
  CoordinatorPipelineState,
  CoordinatorUploadCommit,
} from "./coordinator-types";

type ConflictingDuplicateCommit = Extract<
  ReturnType<typeof resolveDuplicateCommit>,
  { status: "conflict" }
>;

type BlockedPublicationControl = Extract<
  PublicationControlResolution,
  { status: "blocked" }
>;

type RejectedCoordinatorCommitPolicyDecision = Extract<
  CoordinatorCommitPolicyDecision,
  { status: "rejected" }
>;

/**
 * Record an observed upload as a commit against its slot and return the next
 * pipeline state. Pure function on state — persisting the result is the
 * caller's job (typically via `mutateCoordinatorPipeline`).
 *
 * Retrying the same commit is safe: an equivalent commit for the slot
 * resolves as `"idempotent"` without changing state, while a differing one
 * is `"rejected"`. Rejections also cover slot/object mismatches, uploads
 * later than the slot's `expiresAt` plus `lateToleranceMs` (default 0), a
 * failing `commitPolicy`, and publication control blocking the commit or the
 * cursor advancement it would cause.
 *
 * When the new commit completes a contiguous prefix, the cursor advances
 * (never regresses) and retention runs in the same operation: out-of-window
 * commits and expired issued slots are pruned from the returned state, with
 * the pruned commits surfaced as `retiredObjects` so the caller can delete
 * their backing objects.
 */
export function commitCoordinatorUpload(
  options: CommitCoordinatorUploadOptions
): CoordinatorUploadCommit {
  const slot = findSlot(options.state, options.slotId);
  const existingCommit = findCommit(options.state, options.slotId);

  const settled = settleBeforeNewCommit(options, slot, existingCommit);
  if (settled !== undefined) {
    return settled;
  }

  const resolved = resolveNewCommit(options, slot);
  if (resolved.status !== "committed") {
    return rejectCommit(options.state, resolved.error);
  }

  return applyNewCommit(options, resolved.commit, resolved.slot);
}

/**
 * Stages that can settle the request before a new commit is created:
 * publication control, an observation that does not match the slot, an
 * idempotent or conflicting retry, and the deployment's commit policy.
 * Returns the settled result, or `undefined` to go on and commit.
 */
function settleBeforeNewCommit(
  options: CommitCoordinatorUploadOptions,
  slot: UploadSlot | undefined,
  existingCommit: Commit | undefined
): CoordinatorUploadCommit | undefined {
  const publication = resolvePublicationControl({
    operation: "commit_upload",
    policy: options.publicationControl,
  });
  if (isBlockedPublicationControl(publication)) {
    return rejectCommit(options.state, publication.error);
  }

  const rejectedObservation = rejectInvalidObservedUpload({
    existingCommit,
    lateToleranceMs: options.lateToleranceMs,
    object: options.object,
    slot,
    state: options.state,
  });
  if (rejectedObservation !== undefined) {
    return rejectedObservation;
  }

  if (slot !== undefined && existingCommit !== undefined) {
    return resolveDuplicateCoordinatorUploadCommit({
      existingCommit,
      options,
      slot,
    });
  }

  // §4.5.1 orders duplicate resolution before the deadline check, so this
  // only rejects a genuinely new commit; retries returned above already.
  if (slot !== undefined) {
    const lateCommit = rejectLateCommittedAt({
      committedAt: options.committedAt,
      lateToleranceMs: options.lateToleranceMs,
      slot,
      state: options.state,
    });
    if (lateCommit !== undefined) {
      return lateCommit;
    }
  }

  return rejectCoordinatorCommitPolicy({ options, slot });
}

function resolveNewCommit(
  options: CommitCoordinatorUploadOptions,
  slot: UploadSlot | undefined
): ReturnType<typeof resolveCommitAttempt> {
  const observedSlot =
    slot === undefined
      ? undefined
      : observeUpload({
          lateToleranceMs: options.lateToleranceMs,
          object: options.object,
          slot,
        });

  return resolveCommitAttempt({
    commitId: options.commitId,
    committedAt: options.committedAt,
    cursor: options.state.cursor,
    lateToleranceMs: options.lateToleranceMs,
    mediaObject: options.object,
    objectVerified: true,
    profile: options.profile,
    session: options.state.session,
    slot: observedSlot,
    slotId: options.slotId,
  });
}

function applyNewCommit(
  options: CommitCoordinatorUploadOptions,
  commit: Commit,
  slot: UploadSlot
): CoordinatorUploadCommit {
  const { state, retiredObjects } = commitIntoState({
    commit,
    lateToleranceMs: options.lateToleranceMs,
    maxSegments: options.maxSegments,
    slot,
    state: options.state,
    trackWindowProfile: options.trackWindowProfile,
  });

  const blocked = rejectBlockedCursorAdvance(options, state.cursor);
  if (blocked !== undefined) {
    return blocked;
  }

  return {
    commit,
    cursor: state.cursor,
    retiredObjects,
    state,
    status: "committed",
  };
}

/**
 * Publication control gets a second say once the commit has advanced the
 * cursor: a policy may allow the commit itself but block it becoming visible.
 */
function rejectBlockedCursorAdvance(
  options: CommitCoordinatorUploadOptions,
  nextCursor: Cursor | undefined
): CoordinatorUploadCommit | undefined {
  if (nextCursor === options.state.cursor) {
    return;
  }

  const advancement = resolvePublicationControl({
    operation: "advance_cursor",
    policy: options.publicationControl,
  });
  if (!isBlockedPublicationControl(advancement)) {
    return;
  }

  return rejectCommit(options.state, advancement.error);
}

function rejectCommit(
  state: CoordinatorPipelineState,
  error: OlosError
): Extract<CoordinatorUploadCommit, { status: "rejected" }> {
  return { error, state, status: "rejected" };
}

function resolveDuplicateCoordinatorUploadCommit({
  existingCommit,
  options,
  slot,
}: {
  existingCommit: Commit;
  options: CommitCoordinatorUploadOptions;
  slot: UploadSlot;
}): CoordinatorUploadCommit {
  // Reuse the existing commit's committedAt: §4.5.2 excludes it from the
  // idempotency comparison, and the retry's own timestamp would trip the
  // deadline assert instead of the idempotent success §4.5.1 requires.
  const candidateCommit = createCommit({
    commitId: options.commitId,
    committedAt: existingCommit.committedAt,
    lateToleranceMs: options.lateToleranceMs,
    mediaObject: options.object,
    profile: options.profile,
    slot: { ...slot, state: "upload_observed" },
  });
  const duplicate = resolveDuplicateCommit({
    candidateCommit,
    existingCommit,
  });

  if (isConflictingDuplicateCommit(duplicate)) {
    return rejectCommit(options.state, duplicate.error);
  }

  return {
    commit: duplicate.commit,
    state: options.state,
    status: "idempotent",
    ...(options.state.cursor === undefined
      ? {}
      : { cursor: options.state.cursor }),
  };
}

function rejectInvalidObservedUpload(options: {
  existingCommit?: Commit;
  lateToleranceMs?: number;
  object: ObservedUpload;
  slot?: UploadSlot;
  state: CoordinatorPipelineState;
}): Extract<CoordinatorUploadCommit, { status: "rejected" }> | undefined {
  const { existingCommit, object, slot } = options;

  if (slot === undefined) {
    return;
  }

  const invalidState = rejectInvalidSlotState({
    existingCommit,
    slot,
    state: options.state,
  });
  if (invalidState !== undefined) {
    return invalidState;
  }

  const observedSlotId = object.metadata?.["x-olos-slot-id"];

  if (observedSlotId !== undefined && observedSlotId !== slot.slotId) {
    return rejectCommit(
      options.state,
      createOlosError(
        "olos.invalid_state",
        "object slot metadata does not match slot",
        {
          objectKey: object.objectKey,
          observedSlotId,
          slotId: slot.slotId,
        }
      )
    );
  }

  const late = rejectLateObservation({
    lateToleranceMs: options.lateToleranceMs,
    object,
    slot,
    state: options.state,
  });
  if (late !== undefined) {
    return late;
  }

  const mismatch = resolveObjectSlotMismatch({
    includeKeyMismatch: true,
    mediaObject: object,
    slot,
  });

  return mismatch === undefined
    ? undefined
    : rejectCommit(options.state, mismatch.error);
}

function rejectInvalidSlotState(options: {
  existingCommit?: Commit;
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}): Extract<CoordinatorUploadCommit, { status: "rejected" }> | undefined {
  const { existingCommit, slot } = options;

  if (
    existingCommit === undefined &&
    slot.state !== "issued" &&
    slot.state !== "upload_observed"
  ) {
    return rejectCommit(
      options.state,
      createOlosError(
        "olos.invalid_state",
        "upload slot cannot accept an upload in its current state",
        { slotId: slot.slotId, state: slot.state }
      )
    );
  }
}

function rejectLateObservation(options: {
  lateToleranceMs?: number;
  object: ObservedUpload;
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}): Extract<CoordinatorUploadCommit, { status: "rejected" }> | undefined {
  const { object, slot } = options;
  const expiresAtMs = timestampMs(slot.expiresAt, "uploadSlot.expiresAt");
  const observedAtMs = timestampMs(
    object.observedAt,
    "observedUpload.observedAt"
  );

  if (observedAtMs > expiresAtMs + (options.lateToleranceMs ?? 0)) {
    return rejectCommit(
      options.state,
      createOlosError(
        "olos.slot_expired",
        "upload was observed after the slot expired",
        {
          expiresAt: slot.expiresAt,
          observedAt: object.observedAt,
          slotId: slot.slotId,
        }
      )
    );
  }
}

function rejectLateCommittedAt(options: {
  committedAt: string;
  lateToleranceMs?: number;
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}): Extract<CoordinatorUploadCommit, { status: "rejected" }> | undefined {
  const { committedAt, slot } = options;
  const expiresAtMs = timestampMs(slot.expiresAt, "uploadSlot.expiresAt");
  const committedAtMs = timestampMs(committedAt, "commit.committedAt");

  if (committedAtMs > expiresAtMs + (options.lateToleranceMs ?? 0)) {
    return rejectCommit(
      options.state,
      createOlosError(
        "olos.slot_expired",
        "commit was recorded after the slot expired",
        {
          committedAt,
          expiresAt: slot.expiresAt,
          slotId: slot.slotId,
        }
      )
    );
  }
}

function rejectCoordinatorCommitPolicy({
  options,
  slot,
}: {
  options: CommitCoordinatorUploadOptions;
  slot?: UploadSlot;
}): Extract<CoordinatorUploadCommit, { status: "rejected" }> | undefined {
  if (slot === undefined || options.commitPolicy === undefined) {
    return;
  }

  const policy = options.commitPolicy({
    commitId: options.commitId,
    committedAt: options.committedAt,
    object: options.object,
    profile: mergeProfileData(slot.profile, options.profile),
    slot,
    state: options.state,
  });

  if (!isRejectedCoordinatorCommitPolicyDecision(policy)) {
    return;
  }

  return rejectCommit(options.state, policy.error);
}

function findCommit(
  state: CoordinatorPipelineState,
  slotId: OlosId
): Commit | undefined {
  return [...state.initCommits, ...state.commits].find(
    (commit) => commit.slotId === slotId
  );
}

function isConflictingDuplicateCommit(
  result: ReturnType<typeof resolveDuplicateCommit>
): result is ConflictingDuplicateCommit {
  return result.status === "conflict";
}

function isBlockedPublicationControl(
  result: PublicationControlResolution
): result is BlockedPublicationControl {
  return result.status === "blocked";
}

function isRejectedCoordinatorCommitPolicyDecision(
  result: CoordinatorCommitPolicyDecision
): result is RejectedCoordinatorCommitPolicyDecision {
  return result.status === "rejected";
}
