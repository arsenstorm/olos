import {
  createCommit,
  resolveCommitAttempt,
  resolveDuplicateCommit,
} from "../state/commit";
import { createCommittedWindow } from "../state/committed-window";
import { createCursor, resolveCursorUpdate } from "../state/cursor";
import {
  type CreateIssuedUploadSlotOptions,
  createIssuedUploadSlot,
  observeUpload,
} from "../state/upload-slot";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { OlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import type { UploadSlot } from "../types/upload-slot";
import type { ObservedUpload } from "../validation/observed-upload";
import { assertSession } from "../validation/session";

export interface CoordinatorPipelineState {
  commits: readonly Commit[];
  cursor?: Cursor;
  initCommits: readonly Commit[];
  pathways: readonly Pathway[];
  session: Session;
  slots: readonly UploadSlot[];
}

export interface CreateCoordinatorPipelineOptions {
  pathways: readonly Pathway[];
  session: Session;
}

export interface IssueCoordinatorSlotOptions
  extends Omit<CreateIssuedUploadSlotOptions, "session"> {
  state: CoordinatorPipelineState;
}

export interface CoordinatorSlotIssue {
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}

export interface CommitCoordinatorUploadOptions {
  commitId: OlosId;
  committedAt: string;
  independent?: boolean;
  maxSegments?: number;
  object: ObservedUpload;
  programDateTime?: string;
  slotId: OlosId;
  state: CoordinatorPipelineState;
}

export type CoordinatorUploadCommit =
  | {
      commit: Commit;
      cursor?: Cursor;
      state: CoordinatorPipelineState;
      status: "committed" | "idempotent";
    }
  | {
      error: OlosError;
      state: CoordinatorPipelineState;
      status: "rejected";
    };

export function createCoordinatorPipeline(
  options: CreateCoordinatorPipelineOptions
): CoordinatorPipelineState {
  assertSession(options.session);

  if (options.pathways.length === 0) {
    throw new Error("pathways must be a non-empty array");
  }

  return {
    commits: [],
    initCommits: [],
    pathways: [...options.pathways],
    session: options.session,
    slots: [],
  };
}

export function issueCoordinatorSlot(
  options: IssueCoordinatorSlotOptions
): CoordinatorSlotIssue {
  if (findSlot(options.state, options.slotId) !== undefined) {
    throw new Error("slotId must be unique");
  }

  const slot = createIssuedUploadSlot({
    ...options,
    session: options.state.session,
  });

  return {
    slot,
    state: {
      ...options.state,
      slots: [...options.state.slots, slot],
    },
  };
}

export function commitCoordinatorUpload(
  options: CommitCoordinatorUploadOptions
): CoordinatorUploadCommit {
  const slot = findSlot(options.state, options.slotId);
  const existingCommit = findCommit(options.state, options.slotId);

  if (slot !== undefined && existingCommit !== undefined) {
    const candidateCommit = createCommit({
      commitId: options.commitId,
      committedAt: options.committedAt,
      independent: options.independent,
      mediaObject: options.object,
      programDateTime: options.programDateTime,
      slot: { ...slot, state: "upload_observed" },
    });
    const duplicate = resolveDuplicateCommit({
      candidateCommit,
      existingCommit,
    });

    if (duplicate.status === "conflict") {
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

  const observedSlot =
    slot === undefined
      ? undefined
      : observeUpload({
          object: options.object,
          slot,
        });
  const resolved = resolveCommitAttempt({
    commitId: options.commitId,
    committedAt: options.committedAt,
    cursor: options.state.cursor,
    independent: options.independent,
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

  const state = commitIntoState({
    commit: resolved.commit,
    maxSegments: options.maxSegments,
    slot: resolved.slot,
    state: options.state,
  });

  return {
    commit: resolved.commit,
    cursor: state.cursor,
    state,
    status: "committed",
  };
}

function commitIntoState(options: {
  commit: Commit;
  maxSegments?: number;
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}): CoordinatorPipelineState {
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
    return nextState;
  }

  const committedWindow = createCommittedWindow({
    commits,
    epoch: options.state.session.epoch,
    initCommits,
    maxSegments: options.maxSegments,
    sessionId: options.state.session.sessionId,
  });
  const partNumber = lastPartNumber(commits);
  const candidateCursor = createCursor({
    committedWindow,
    latencyProfile: options.state.session.latencyProfile,
    partTarget: options.state.session.partTarget,
    pathways: options.state.pathways,
    segmentTarget: options.state.session.segmentTarget,
    sessionId: options.state.session.sessionId,
    state: options.state.session.state,
    tenantId: options.state.session.tenantId,
    updatedAt: options.commit.committedAt,
    ...(partNumber === undefined ? {} : { lastPartNumber: partNumber }),
  });

  if (options.state.cursor === undefined) {
    return {
      ...nextState,
      cursor: candidateCursor,
    };
  }

  const update = resolveCursorUpdate({
    candidateCursor,
    currentCursor: options.state.cursor,
  });

  return {
    ...nextState,
    cursor:
      update.status === "regression" ? options.state.cursor : update.cursor,
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
