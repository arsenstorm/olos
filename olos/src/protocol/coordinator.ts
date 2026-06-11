import {
  type CreateHlsManifestArtifactsOptions,
  createHlsManifestArtifacts,
  type HlsManifestArtifact,
} from "../hls/manifest-artifacts";
import {
  createCommit,
  resolveCommitAttempt,
  resolveDuplicateCommit,
} from "../state/commit";
import { createCommittedWindow } from "../state/committed-window";
import { createCursor, resolveCursorUpdate } from "../state/cursor";
import {
  type RetiredCommittedObject,
  selectExpiredUploadSlots,
  selectRetiredCommittedObjects,
} from "../state/retention";
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

export interface CoordinatorPipelineSnapshot {
  etag: string;
  state: CoordinatorPipelineState;
}

export interface CreateCoordinatorPipelineOptions {
  pathways: readonly Pathway[];
  session: Session;
}

export interface CoordinatorPipelineStore {
  load(sessionId: OlosId): Promise<CoordinatorPipelineSnapshot | undefined>;
  save(options: SaveCoordinatorPipelineOptions): Promise<CoordinatorStoreSave>;
}

export interface SaveCoordinatorPipelineOptions {
  expectedEtag?: string;
  sessionId: OlosId;
  state: CoordinatorPipelineState;
}

export type CoordinatorStoreSave =
  | {
      etag: string;
      state: CoordinatorPipelineState;
      status: "saved";
    }
  | {
      current?: CoordinatorPipelineSnapshot;
      status: "conflict";
    };

export interface MutateCoordinatorPipelineOptions {
  maxAttempts?: number;
  mutate(
    state: CoordinatorPipelineState
  ): CoordinatorPipelineState | Promise<CoordinatorPipelineState>;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

export type CoordinatorPipelineMutation =
  | {
      etag: string;
      state: CoordinatorPipelineState;
      status: "saved";
    }
  | {
      current?: CoordinatorPipelineSnapshot;
      status: "conflict";
    }
  | {
      status: "not_found";
    };

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

export interface CreateCoordinatorManifestArtifactsOptions
  extends CreateHlsManifestArtifactsOptions {
  state: CoordinatorPipelineState;
}

export interface CoordinatorManifestArtifacts {
  artifacts: readonly HlsManifestArtifact[];
  cursor?: Cursor;
}

export interface PlanCoordinatorRetentionOptions {
  now: string;
  state: CoordinatorPipelineState;
}

export interface CoordinatorRetentionPlan {
  cursor?: Cursor;
  expiredSlots: readonly UploadSlot[];
  retiredObjects: readonly RetiredCommittedObject[];
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

export function createMemoryCoordinatorStore(): CoordinatorPipelineStore {
  const entries = new Map<string, CoordinatorPipelineSnapshot>();

  return {
    load(sessionId) {
      const snapshot = entries.get(sessionId);

      return Promise.resolve(
        snapshot === undefined ? undefined : cloneSnapshot(snapshot)
      );
    },
    save(options) {
      const current = entries.get(options.sessionId);

      if (
        current !== undefined &&
        options.expectedEtag !== undefined &&
        current.etag !== options.expectedEtag
      ) {
        return Promise.resolve({
          current: cloneSnapshot(current),
          status: "conflict" as const,
        });
      }

      const snapshot = {
        etag: nextEtag(current),
        state: cloneState(options.state),
      };
      entries.set(options.sessionId, snapshot);

      return Promise.resolve({
        etag: snapshot.etag,
        state: cloneState(snapshot.state),
        status: "saved" as const,
      });
    },
  };
}

export async function mutateCoordinatorPipeline(
  options: MutateCoordinatorPipelineOptions
): Promise<CoordinatorPipelineMutation> {
  const maxAttempts = options.maxAttempts ?? 2;
  let snapshot = await options.store.load(options.sessionId);

  if (snapshot === undefined) {
    return { status: "not_found" };
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const state = await options.mutate(snapshot.state);
    const saved = await options.store.save({
      expectedEtag: snapshot.etag,
      sessionId: options.sessionId,
      state,
    });

    if (saved.status === "saved") {
      return saved;
    }

    if (saved.current === undefined) {
      return saved;
    }

    snapshot = saved.current;
  }

  return {
    current: snapshot,
    status: "conflict",
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

export function createCoordinatorManifestArtifacts(
  options: CreateCoordinatorManifestArtifactsOptions
): CoordinatorManifestArtifacts {
  const cursor = options.state.cursor;

  if (cursor === undefined) {
    return { artifacts: [] };
  }

  const { state, ...artifactOptions } = options;

  return {
    artifacts: createHlsManifestArtifacts(
      state.session,
      cursor.committedWindow,
      artifactOptions
    ),
    cursor,
  };
}

export function planCoordinatorRetention(
  options: PlanCoordinatorRetentionOptions
): CoordinatorRetentionPlan {
  const cursor = options.state.cursor;

  return {
    expiredSlots: selectExpiredUploadSlots({
      now: options.now,
      slots: options.state.slots,
    }),
    retiredObjects:
      cursor === undefined
        ? []
        : selectRetiredCommittedObjects({
            commits: options.state.commits,
            retainedWindow: cursor.committedWindow,
          }),
    ...(cursor === undefined ? {} : { cursor }),
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

function nextEtag(current: CoordinatorPipelineSnapshot | undefined): string {
  if (current === undefined) {
    return "1";
  }

  return String(Number(current.etag) + 1);
}

function cloneSnapshot(
  snapshot: CoordinatorPipelineSnapshot
): CoordinatorPipelineSnapshot {
  return {
    etag: snapshot.etag,
    state: cloneState(snapshot.state),
  };
}

function cloneState(state: CoordinatorPipelineState): CoordinatorPipelineState {
  return {
    ...state,
    commits: state.commits.map((commit) => ({ ...commit })),
    initCommits: state.initCommits.map((commit) => ({ ...commit })),
    pathways: state.pathways.map((pathway) => ({ ...pathway })),
    slots: state.slots.map((slot) => ({ ...slot })),
    ...(state.cursor === undefined
      ? {}
      : { cursor: cloneCursor(state.cursor) }),
    session: {
      ...state.session,
      renditions: state.session.renditions.map((rendition) => ({
        ...rendition,
      })),
    },
  };
}

function cloneCursor(cursor: Cursor): Cursor {
  return {
    ...cursor,
    pathways: cursor.pathways.map((pathway) => ({ ...pathway })),
  };
}
