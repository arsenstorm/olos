import {
  createCommit,
  resolveCommitAttempt,
  resolveDuplicateCommit,
  resolveObjectSlotMismatch,
} from "../state/commit";
import { tryCreateCommittedWindow } from "../state/committed-window";
import { createCursor, resolveCursorUpdate } from "../state/cursor";
import {
  type PublicationControlResolution,
  resolvePublicationControl,
} from "../state/publication-control";
import {
  type RetiredCommittedObject,
  selectExpiredUploadSlots,
  selectRetiredCommittedObjects,
} from "../state/retention";
import { observeUpload } from "../state/upload-slot";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { OlosId } from "../types/ids";
import type { UploadSlot } from "../types/upload-slot";
import type { ObservedUpload } from "../validation/observed-upload";
import type {
  CommitCoordinatorUploadOptions,
  CoordinatorCommitPolicyDecision,
  CoordinatorPipelineState,
  CoordinatorUploadCommit,
} from "./coordinator";
import { coordinatorError } from "./coordinator-error";

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

export function commitCoordinatorUpload(
  options: CommitCoordinatorUploadOptions
): CoordinatorUploadCommit {
  const publication = resolvePublicationControl({
    operation: "commit_upload",
    policy: options.publicationControl,
  });

  if (isBlockedPublicationControl(publication)) {
    return {
      error: publication.error,
      state: options.state,
      status: "rejected",
    };
  }

  const slot = findSlot(options.state, options.slotId);
  const existingCommit = findCommit(options.state, options.slotId);
  const rejectedObservation = rejectInvalidObservedUpload({
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

  const rejectedCommitPolicy = rejectCoordinatorCommitPolicy({
    options,
    slot,
  });

  if (rejectedCommitPolicy !== undefined) {
    return rejectedCommitPolicy;
  }

  const observedSlot =
    slot === undefined
      ? undefined
      : observeUpload({
          lateToleranceMs: options.lateToleranceMs,
          object: options.object,
          slot,
        });
  const resolved = resolveCommitAttempt({
    commitId: options.commitId,
    committedAt: options.committedAt,
    cursor: options.state.cursor,
    independent: options.independent,
    lateToleranceMs: options.lateToleranceMs,
    mediaObject: options.object,
    objectVerified: true,
    programDateTime: options.programDateTime,
    session: options.state.session,
    slot: observedSlot,
    slotId: options.slotId,
  });

  if (resolved.status !== "committed") {
    return {
      error: resolved.error,
      state: options.state,
      status: "rejected",
    };
  }

  const { state, retiredObjects } = commitIntoState({
    commit: resolved.commit,
    maxSegments: options.maxSegments,
    slot: resolved.slot,
    state: options.state,
  });

  if (state.cursor !== options.state.cursor) {
    const cursorAdvancement = resolvePublicationControl({
      operation: "advance_cursor",
      policy: options.publicationControl,
    });

    if (isBlockedPublicationControl(cursorAdvancement)) {
      return {
        error: cursorAdvancement.error,
        state: options.state,
        status: "rejected",
      };
    }
  }

  return {
    commit: resolved.commit,
    cursor: state.cursor,
    retiredObjects,
    state,
    status: "committed",
  };
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
  const candidateCommit = createCommit({
    commitId: options.commitId,
    committedAt: options.committedAt,
    independent: options.independent,
    lateToleranceMs: options.lateToleranceMs,
    mediaObject: options.object,
    programDateTime: options.programDateTime,
    slot: { ...slot, state: "upload_observed" },
  });
  const duplicate = resolveDuplicateCommit({
    candidateCommit,
    existingCommit,
  });

  if (isConflictingDuplicateCommit(duplicate)) {
    return {
      error: duplicate.error,
      state: options.state,
      status: "rejected",
    };
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
  object: ObservedUpload;
  slot?: UploadSlot;
  state: CoordinatorPipelineState;
}): Extract<CoordinatorUploadCommit, { status: "rejected" }> | undefined {
  const { object, slot } = options;

  if (slot === undefined) {
    return;
  }

  const observedSlotId = object.metadata?.["x-olos-slot-id"];

  if (observedSlotId !== undefined && observedSlotId !== slot.slotId) {
    return {
      error: coordinatorError(
        "olos.invalid_state",
        "object slot metadata does not match slot",
        {
          objectKey: object.objectKey,
          observedSlotId,
          slotId: slot.slotId,
        }
      ),
      state: options.state,
      status: "rejected",
    };
  }

  const mismatch = resolveObjectSlotMismatch({
    mediaObject: object,
    slot,
  });

  return mismatch === undefined
    ? undefined
    : {
        error: mismatch.error,
        state: options.state,
        status: "rejected",
      };
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
    slot,
    state: options.state,
  });

  if (!isRejectedCoordinatorCommitPolicyDecision(policy)) {
    return;
  }

  return {
    error: policy.error,
    state: options.state,
    status: "rejected",
  };
}

interface CommitIntoStateResult {
  retiredObjects: readonly RetiredCommittedObject[];
  state: CoordinatorPipelineState;
}

function commitIntoState(options: {
  commit: Commit;
  maxSegments?: number;
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}): CommitIntoStateResult {
  const slots = options.state.slots.map((slot) =>
    slot.slotId === options.slot.slotId ? options.slot : slot
  );
  const initCommits =
    options.slot.kind === "init"
      ? [...options.state.initCommits, options.commit]
      : options.state.initCommits;
  const commits =
    options.slot.kind === "init"
      ? options.state.commits
      : [...options.state.commits, options.commit];

  const nextState: CoordinatorPipelineState = {
    ...options.state,
    commits,
    initCommits,
    slots,
  };

  if (initCommits.length === 0 || commits.length === 0) {
    return { retiredObjects: [], state: nextState };
  }

  const committedWindow = tryCreateCommittedWindow({
    commits,
    epoch: options.state.session.epoch,
    initCommits,
    maxSegments: options.maxSegments,
    sessionId: options.state.session.sessionId,
  });

  // Out-of-order commit at the same media sequence — the contiguous-prefix
  // rule means no parts qualify for the manifest yet. The commit is still
  // recorded in state.commits; the cursor stays at whatever it was, and
  // the next contiguous commit will advance it.
  if (committedWindow === undefined) {
    return { retiredObjects: [], state: nextState };
  }

  const partNumber = lastPartNumber(commits);
  const candidateCursor = createCursor({
    committedWindow,
    latencyProfile: options.state.session.latencyProfile,
    mediaBaseUrl: options.state.mediaBaseUrl,
    partTarget: options.state.session.partTarget,
    segmentTarget: options.state.session.segmentTarget,
    sessionId: options.state.session.sessionId,
    state: options.state.session.state,
    updatedAt: options.commit.committedAt,
    ...(partNumber === undefined ? {} : { lastPartNumber: partNumber }),
  });

  const cursor = resolveNextCursor(options.state.cursor, candidateCursor);
  return retainCommitsWithinWindow(
    { ...nextState, cursor },
    options.commit.committedAt
  );
}

function resolveNextCursor(
  current: Cursor | undefined,
  candidate: Cursor
): Cursor {
  if (current === undefined) {
    return candidate;
  }

  const update = resolveCursorUpdate({
    candidateCursor: candidate,
    currentCursor: current,
  });

  return update.status === "regression" ? current : update.cursor;
}

// Drop commits whose slots have fallen out of the live window AND their
// matching slots from `state.slots`; also drop issued slots whose grant
// expired without an upload. Without this both arrays accumulate forever,
// the persisted snapshot grows linearly with session age, and every read
// pays O(session-age) JSON parse + scan. The pruned commits surface as
// `retiredObjects` so the runtime can delete their backing objects from
// storage in the same operation; expired-issued slot grants have no
// uploaded object so they don't appear in retiredObjects.
function retainCommitsWithinWindow(
  state: CoordinatorPipelineState,
  now: string
): CommitIntoStateResult {
  if (state.cursor === undefined) {
    return { retiredObjects: [], state };
  }

  const retiredObjects = selectRetiredCommittedObjects({
    commits: state.commits,
    retainedWindow: state.cursor.committedWindow,
  });
  const expiredSlots = selectExpiredUploadSlots({
    now,
    slots: state.slots,
  });

  if (retiredObjects.length === 0 && expiredSlots.length === 0) {
    return { retiredObjects: [], state };
  }

  const obsoleteSlotIds = new Set([
    ...retiredObjects.map((object) => object.slotId),
    ...expiredSlots.map((slot) => slot.slotId),
  ]);
  const retainedCommits = state.commits.filter(
    (commit) => !obsoleteSlotIds.has(commit.slotId)
  );
  const retainedSlots = state.slots.filter(
    (slot) => !obsoleteSlotIds.has(slot.slotId)
  );

  return {
    retiredObjects,
    state: {
      ...state,
      commits: retainedCommits,
      slots: retainedSlots,
    },
  };
}

function findSlot(
  state: CoordinatorPipelineState,
  slotId: OlosId
): UploadSlot | undefined {
  return state.slots.find((slot) => slot.slotId === slotId);
}

function findCommit(
  state: CoordinatorPipelineState,
  slotId: OlosId
): Commit | undefined {
  return [...state.initCommits, ...state.commits].find(
    (commit) => commit.slotId === slotId
  );
}

function lastPartNumber(commits: readonly Commit[]): number | undefined {
  const lastMediaSequenceNumber = Math.max(
    ...commits.map((commit) => commit.mediaSequenceNumber)
  );
  const partNumbers = commits
    .filter((commit) => commit.mediaSequenceNumber === lastMediaSequenceNumber)
    .flatMap((commit) =>
      commit.partNumber === undefined ? [] : [commit.partNumber]
    );

  if (partNumbers.length === 0) {
    return;
  }

  return Math.max(...partNumbers);
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
