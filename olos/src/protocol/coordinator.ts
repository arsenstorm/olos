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
  assertPublicationAllowed,
  type PublicationControlPolicy,
  resolvePublicationControl,
} from "../state/publication-control";
import {
  type RetiredCommittedObject,
  selectExpiredUploadSlots,
  selectRetiredCommittedObjects,
} from "../state/retention";
import {
  type CreateIssuedUploadSlotOptions,
  canTransitionUploadSlot,
  createIssuedUploadSlot,
  observeUpload,
  revokeUpload,
} from "../state/upload-slot";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { OlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import type { UploadSlot } from "../types/upload-slot";
import { isRecord } from "../validation/fields";
import type { ObservedUpload } from "../validation/observed-upload";
import { assertSession } from "../validation/session";

export interface CoordinatorPublisherLease {
  expiresAt: string;
  issuedAt: string;
  lastSeenAt: string;
  publisherInstanceId: OlosId;
  sessionId: OlosId;
  tenantId: OlosId;
}

export interface CoordinatorPipelineState {
  commits: readonly Commit[];
  cursor?: Cursor;
  initCommits: readonly Commit[];
  pathways: readonly Pathway[];
  publisherLeases: readonly CoordinatorPublisherLease[];
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

type SavedCoordinatorStoreSave = Extract<
  CoordinatorStoreSave,
  { status: "saved" }
>;

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
  publicationControl?: PublicationControlPolicy;
  state: CoordinatorPipelineState;
}

export interface CoordinatorSlotIssue {
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}

export interface CommitCoordinatorUploadOptions {
  commitId: OlosId;
  commitPolicy?: CoordinatorCommitPolicy;
  committedAt: string;
  independent?: boolean;
  lateToleranceMs?: number;
  maxSegments?: number;
  object: ObservedUpload;
  programDateTime?: string;
  publicationControl?: PublicationControlPolicy;
  slotId: OlosId;
  state: CoordinatorPipelineState;
}

export interface CoordinatorCommitPolicyContext {
  commitId: OlosId;
  committedAt: string;
  object: ObservedUpload;
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}

export type CoordinatorCommitPolicyDecision =
  | { status: "allowed" }
  | {
      error: OlosError;
      status: "rejected";
    };

export type CoordinatorCommitPolicy = (
  context: CoordinatorCommitPolicyContext
) => CoordinatorCommitPolicyDecision;

export interface RevokeCoordinatorUploadOptions {
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

export type CoordinatorUploadRevocation =
  | {
      slot: UploadSlot;
      state: CoordinatorPipelineState;
      status: "already_revoked" | "revoked";
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
    publisherLeases: [],
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

      if (current === undefined && options.expectedEtag !== undefined) {
        return Promise.resolve({
          status: "conflict" as const,
        });
      }

      if (current !== undefined && options.expectedEtag === undefined) {
        return Promise.resolve({
          current: cloneSnapshot(current),
          status: "conflict" as const,
        });
      }

      if (current !== undefined && current.etag !== options.expectedEtag) {
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

export function cloneCoordinatorPipelineSnapshot(
  snapshot: CoordinatorPipelineSnapshot
): CoordinatorPipelineSnapshot {
  return {
    etag: snapshot.etag,
    state: cloneCoordinatorPipelineState(snapshot.state),
  };
}

export function cloneCoordinatorPipelineState(
  state: CoordinatorPipelineState
): CoordinatorPipelineState {
  return {
    ...state,
    commits: state.commits.map((commit) => ({ ...commit })),
    initCommits: state.initCommits.map((commit) => ({ ...commit })),
    pathways: state.pathways.map((pathway) => ({ ...pathway })),
    publisherLeases: (state.publisherLeases ?? []).map((lease) => ({
      ...lease,
    })),
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

export function createNextCoordinatorPipelineEtag(current?: string): string {
  if (current === undefined) {
    return "1";
  }

  const value = Number(current);

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("coordinator pipeline etag must be a non-negative integer");
  }

  return String(value + 1);
}

export function serializeCoordinatorPipelineSnapshot(
  snapshot: CoordinatorPipelineSnapshot
): string {
  return JSON.stringify(cloneCoordinatorPipelineSnapshot(snapshot));
}

export function parseCoordinatorPipelineSnapshot(
  value: unknown
): CoordinatorPipelineSnapshot {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;

  assertCoordinatorPipelineSnapshot(parsed);

  return cloneCoordinatorPipelineSnapshot(parsed);
}

export async function mutateCoordinatorPipeline(
  options: MutateCoordinatorPipelineOptions
): Promise<CoordinatorPipelineMutation> {
  const maxAttempts = positiveMutationAttempts(options.maxAttempts);
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

    if (isSavedCoordinatorStoreSave(saved)) {
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

function positiveMutationAttempts(value: number | undefined): number {
  const attempts = value ?? 2;

  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("maxAttempts must be a positive integer");
  }

  return attempts;
}

function isSavedCoordinatorStoreSave(
  result: CoordinatorStoreSave
): result is SavedCoordinatorStoreSave {
  return result.status === "saved";
}

export function issueCoordinatorSlot(
  options: IssueCoordinatorSlotOptions
): CoordinatorSlotIssue {
  assertPublicationAllowed({
    operation: "issue_slot",
    policy: options.publicationControl,
  });

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
  const publication = resolvePublicationControl({
    operation: "commit_upload",
    policy: options.publicationControl,
  });

  if (publication.status === "blocked") {
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

  if (slot !== undefined && options.commitPolicy !== undefined) {
    const policy = options.commitPolicy({
      commitId: options.commitId,
      committedAt: options.committedAt,
      object: options.object,
      slot,
      state: options.state,
    });

    if (policy.status === "rejected") {
      return {
        error: policy.error,
        state: options.state,
        status: "rejected",
      };
    }
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

  const state = commitIntoState({
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

    if (cursorAdvancement.status === "blocked") {
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
    state,
    status: "committed",
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

  if (object.contentType !== slot.contentType) {
    return {
      error: coordinatorError(
        "olos.content_type_mismatch",
        "object content type does not match slot",
        {
          contentType: object.contentType,
          objectKey: object.objectKey,
          slotContentType: slot.contentType,
          slotId: slot.slotId,
        }
      ),
      state: options.state,
      status: "rejected",
    };
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

  if (object.size <= slot.maxBytes) {
    return;
  }

  return {
    error: coordinatorError(
      "olos.object_too_large",
      "object exceeds slot limit",
      {
        maxBytes: slot.maxBytes,
        objectKey: object.objectKey,
        size: object.size,
        slotId: slot.slotId,
      }
    ),
    state: options.state,
    status: "rejected",
  };
}

export function revokeCoordinatorUpload(
  options: RevokeCoordinatorUploadOptions
): CoordinatorUploadRevocation {
  const slot = findSlot(options.state, options.slotId);

  if (slot === undefined) {
    return {
      error: coordinatorError(
        "olos.unknown_slot",
        "upload slot was not found",
        {
          slotId: options.slotId,
        }
      ),
      state: options.state,
      status: "rejected",
    };
  }

  if (isSlotInCursor(options.state, slot)) {
    return {
      error: coordinatorError(
        "olos.invalid_state",
        "announced upload slots cannot be silently revoked",
        { slotId: slot.slotId, state: slot.state }
      ),
      state: options.state,
      status: "rejected",
    };
  }

  if (
    slot.state !== "revoked" &&
    !canTransitionUploadSlot(slot.state, "revoked")
  ) {
    return {
      error: coordinatorError(
        "olos.invalid_state",
        "upload slot cannot be revoked from its current state",
        { slotId: slot.slotId, state: slot.state }
      ),
      state: options.state,
      status: "rejected",
    };
  }

  const result = revokeUpload({ slot });

  return {
    slot: result,
    state: removeSlotCommit({
      slot: result,
      state: options.state,
    }),
    status: slot.state === "revoked" ? "already_revoked" : "revoked",
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

function removeSlotCommit(options: {
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}): CoordinatorPipelineState {
  return {
    ...options.state,
    commits: options.state.commits.filter(
      (commit) => commit.slotId !== options.slot.slotId
    ),
    initCommits: options.state.initCommits.filter(
      (commit) => commit.slotId !== options.slot.slotId
    ),
    slots: options.state.slots.map((slot) =>
      slot.slotId === options.slot.slotId ? options.slot : slot
    ),
  };
}

function isSlotInCursor(
  state: CoordinatorPipelineState,
  slot: UploadSlot
): boolean {
  const cursor = state.cursor;

  if (cursor === undefined) {
    return false;
  }

  return Object.values(cursor.committedWindow.renditions).some((rendition) => {
    if (rendition.init.slotId === slot.slotId) {
      return true;
    }

    return rendition.segments.some(
      (segment) =>
        segment.segment?.slotId === slot.slotId ||
        segment.parts?.some((part) => part.slotId === slot.slotId) === true
    );
  });
}

function coordinatorError(
  code: OlosError["error"]["code"],
  message: string,
  details: Record<string, unknown>
): OlosError {
  return {
    error: {
      code,
      details,
      message,
    },
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
  return createNextCoordinatorPipelineEtag(current?.etag);
}

function cloneSnapshot(
  snapshot: CoordinatorPipelineSnapshot
): CoordinatorPipelineSnapshot {
  return cloneCoordinatorPipelineSnapshot(snapshot);
}

function cloneState(state: CoordinatorPipelineState): CoordinatorPipelineState {
  return cloneCoordinatorPipelineState(state);
}

function cloneCursor(cursor: Cursor): Cursor {
  return {
    ...cursor,
    pathways: cursor.pathways.map((pathway) => ({ ...pathway })),
  };
}

function assertCoordinatorPipelineSnapshot(
  value: unknown
): asserts value is CoordinatorPipelineSnapshot {
  if (!isRecord(value)) {
    throw new Error("coordinator pipeline snapshot must be an object");
  }

  if (typeof value.etag !== "string" || value.etag.length === 0) {
    throw new Error(
      "coordinator pipeline snapshot etag must be a non-empty string"
    );
  }

  assertCoordinatorPipelineState(value.state);
}

function assertCoordinatorPipelineState(
  value: unknown
): asserts value is CoordinatorPipelineState {
  if (!isRecord(value)) {
    throw new Error("coordinator pipeline state must be an object");
  }

  assertSession(value.session);
  assertArray(value.pathways, "coordinator pipeline state pathways");
  assertArray(value.slots, "coordinator pipeline state slots");
  assertArray(value.initCommits, "coordinator pipeline state initCommits");
  assertArray(value.commits, "coordinator pipeline state commits");
  if (value.publisherLeases !== undefined) {
    assertArray(
      value.publisherLeases,
      "coordinator pipeline state publisherLeases"
    );
  }

  if (value.cursor !== undefined && !isRecord(value.cursor)) {
    throw new Error("coordinator pipeline state cursor must be an object");
  }
}

function assertArray(value: unknown, name: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
}
