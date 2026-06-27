import type {
  CreateHlsManifestArtifactsOptions,
  HlsManifestArtifact,
} from "../hls/manifest-artifacts";
import type { PublicationControlPolicy } from "../state/publication-control";
import type { RetiredCommittedObject } from "../state/retention";
import type { CreateIssuedUploadSlotOptions } from "../state/upload-slot";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { OlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { Session } from "../types/session";
import type { PublicationMode, UploadSlot } from "../types/upload-slot";
import { assertNonNegativeSafeInteger } from "../validation/ids";
import type { ObservedUpload } from "../validation/observed-upload";
import { commitCoordinatorUpload as commitCoordinatorUploadInternal } from "./coordinator-commit";
import {
  createCoordinatorManifestArtifacts as createCoordinatorManifestArtifactsInternal,
  createCoordinatorPipeline as createCoordinatorPipelineInternal,
  planCoordinatorRetention as planCoordinatorRetentionInternal,
} from "./coordinator-lifecycle";
import { createMemoryCoordinatorStore as createMemoryCoordinatorStoreFromStore } from "./coordinator-memory-store";
import { mutateCoordinatorPipeline as mutateCoordinatorPipelineInternal } from "./coordinator-mutation";
import {
  issueCoordinatorSlot as issueCoordinatorSlotInternal,
  revokeCoordinatorUpload as revokeCoordinatorUploadInternal,
} from "./coordinator-slot";
import {
  cloneCoordinatorPipelineSnapshot as cloneCoordinatorPipelineSnapshotFromStore,
  cloneCoordinatorPipelineState as cloneCoordinatorPipelineStateFromStore,
  parseCoordinatorPipelineSnapshot as parseCoordinatorPipelineSnapshotFromStore,
  serializeCoordinatorPipelineSnapshot as serializeCoordinatorPipelineSnapshotFromStore,
} from "./coordinator-snapshot";

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
  mediaBaseUrl: string;
  publicationMode?: PublicationMode;
  publisherLeases: readonly CoordinatorPublisherLease[];
  session: Session;
  slots: readonly UploadSlot[];
}

export interface CoordinatorPipelineSnapshot {
  etag: string;
  state: CoordinatorPipelineState;
}

export interface CreateCoordinatorPipelineOptions {
  mediaBaseUrl: string;
  publicationMode?: PublicationMode;
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
  extends Omit<
    CreateIssuedUploadSlotOptions,
    "deliveryUrl" | "objectKey" | "session"
  > {
  deliveryUrl?: string;
  extension?: string;
  objectKey?: string;
  objectKeyNonce?: string;
  objectKeyPrefix?: string;
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

export function createMemoryCoordinatorStore(): CoordinatorPipelineStore {
  return createMemoryCoordinatorStoreFromStore();
}

export function commitCoordinatorUpload(
  ...args: Parameters<typeof commitCoordinatorUploadInternal>
): ReturnType<typeof commitCoordinatorUploadInternal> {
  return commitCoordinatorUploadInternal(...args);
}

export function createCoordinatorPipeline(
  ...args: Parameters<typeof createCoordinatorPipelineInternal>
): ReturnType<typeof createCoordinatorPipelineInternal> {
  return createCoordinatorPipelineInternal(...args);
}

export function createCoordinatorManifestArtifacts(
  ...args: Parameters<typeof createCoordinatorManifestArtifactsInternal>
): ReturnType<typeof createCoordinatorManifestArtifactsInternal> {
  return createCoordinatorManifestArtifactsInternal(...args);
}

export function planCoordinatorRetention(
  ...args: Parameters<typeof planCoordinatorRetentionInternal>
): ReturnType<typeof planCoordinatorRetentionInternal> {
  return planCoordinatorRetentionInternal(...args);
}

export function mutateCoordinatorPipeline(
  ...args: Parameters<typeof mutateCoordinatorPipelineInternal>
): ReturnType<typeof mutateCoordinatorPipelineInternal> {
  return mutateCoordinatorPipelineInternal(...args);
}

export function issueCoordinatorSlot(
  ...args: Parameters<typeof issueCoordinatorSlotInternal>
): ReturnType<typeof issueCoordinatorSlotInternal> {
  return issueCoordinatorSlotInternal(...args);
}

export function revokeCoordinatorUpload(
  ...args: Parameters<typeof revokeCoordinatorUploadInternal>
): ReturnType<typeof revokeCoordinatorUploadInternal> {
  return revokeCoordinatorUploadInternal(...args);
}

export function cloneCoordinatorPipelineSnapshot(
  snapshot: CoordinatorPipelineSnapshot
): CoordinatorPipelineSnapshot {
  return cloneCoordinatorPipelineSnapshotFromStore(snapshot);
}

export function cloneCoordinatorPipelineState(
  state: CoordinatorPipelineState
): CoordinatorPipelineState {
  return cloneCoordinatorPipelineStateFromStore(state);
}

export function parseCoordinatorPipelineSnapshot(
  value: unknown
): CoordinatorPipelineSnapshot {
  return parseCoordinatorPipelineSnapshotFromStore(value);
}

export function serializeCoordinatorPipelineSnapshot(
  snapshot: CoordinatorPipelineSnapshot
): string {
  return serializeCoordinatorPipelineSnapshotFromStore(snapshot);
}

export function createNextCoordinatorPipelineEtag(current?: string): string {
  if (current === undefined) {
    return "1";
  }

  const value = Number(current);

  assertNonNegativeSafeInteger(value, "coordinator pipeline etag");

  return String(value + 1);
}
