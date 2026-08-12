import type { S3Client } from "@aws-sdk/client-s3";
import type {
  CoordinatorManifestArtifacts,
  CreateCoordinatorManifestArtifactsOptions,
  CreateHlsManifestArtifactResponseOptions,
  HlsManifestArtifact,
  HlsManifestArtifactResponse,
} from "../hls/manifest-artifact-types";
import type {
  CoordinatorCommitPolicy,
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineState,
  CoordinatorPipelineStore,
  CoordinatorUploadCommit,
  IssueCoordinatorSlotOptions,
} from "../protocol/coordinator-types";
import type { UploadEventNormalization } from "../state/observed-upload-types";
import type {
  PublicationControlPolicy,
  PublicationControlResolution,
} from "../state/publication-control";
import type { OlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import type { S3HeadObjectClient } from "./object-observation";

/** The presigning inputs carried past the slot mutation, unchanged by it. */
export type S3PresignGrantOptions = Pick<
  IssueStoredS3CoordinatorUploadGrantOptions,
  "additionalHeaders" | "bucket" | "client" | "expiresInSeconds" | "now"
>;

/** Options for {@link commitS3CoordinatorUpload}. */
export interface CommitS3CoordinatorUploadOptions {
  bucket: string;
  client: S3HeadObjectClient;
  commitId: OlosId;
  commitPolicy?: CoordinatorCommitPolicy;
  committedAt: string;
  independent?: boolean;
  lateToleranceMs?: number;
  maxSegments?: number;
  programDateTime?: string;
  providerId: string;
  publicationControl?: PublicationControlPolicy;
  slotId: OlosId;
  state: CoordinatorPipelineState;
  versionId?: string;
}

/** Options for {@link commitStoredS3CoordinatorUpload}. */
export interface CommitStoredS3CoordinatorUploadOptions
  extends Omit<CommitS3CoordinatorUploadOptions, "state"> {
  /** When set, manifest artifacts are rendered into the commit result. */
  manifest?: StoredS3CoordinatorManifestOptions;
  /** Optimistic-concurrency retries before giving up as a conflict. */
  maxAttempts?: number;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

/** Options for {@link completeStoredS3CoordinatorUpload}. */
export interface CompleteStoredS3CoordinatorUploadOptions
  extends CommitStoredS3CoordinatorUploadOptions {
  /**
   * When set, the slot's object key must match or the completion is
   * rejected with `olos.key_mismatch`.
   */
  objectKey?: string;
}

/** Options for {@link completeStoredS3CoordinatorUploadByObjectKey}. */
export interface CompleteStoredS3CoordinatorUploadByObjectKeyOptions
  extends Omit<
    CompleteStoredS3CoordinatorUploadOptions,
    "objectKey" | "slotId"
  > {
  /** Object key used to look up the slot to complete. */
  objectKey: string;
}

/** Options for {@link routeStoredS3CoordinatorUploadEvent}. */
export interface RouteStoredS3CoordinatorUploadEventOptions {
  bucket: string;
  client: S3HeadObjectClient;
  commitPolicy?: CoordinatorCommitPolicy;
  event: UploadEventNormalization;
  independent?: boolean;
  lateToleranceMs?: number;
  manifest?: StoredS3CoordinatorManifestOptions;
  maxAttempts?: number;
  maxSegments?: number;
  programDateTime?: string;
  providerId: string;
  publicationControl?: PublicationControlPolicy;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
  versionId?: string;
}

/**
 * Manifest rendering options attached to a stored commit. When present, the
 * commit result includes freshly rendered HLS manifest artifacts for the
 * post-commit state.
 */
export interface StoredS3CoordinatorManifestOptions
  extends Omit<CreateCoordinatorManifestArtifactsOptions, "state"> {
  /** HTTP response rendering options (headers, status) per artifact. */
  response?: CreateHlsManifestArtifactResponseOptions;
}

/** HLS manifest artifact paired with its ready-to-serve HTTP response. */
export interface StoredS3CoordinatorManifestArtifact
  extends HlsManifestArtifact {
  response: HlsManifestArtifactResponse;
}

/** Manifest artifacts rendered from the state a commit produced. */
export interface StoredS3CoordinatorManifest {
  artifacts: readonly StoredS3CoordinatorManifestArtifact[];
  cursor?: CoordinatorManifestArtifacts["cursor"];
}

/**
 * Audit record attached to a rejected commit when an uploaded object
 * exceeded the slot's size limit (`olos.object_too_large`), so callers can
 * log or forward the violation.
 */
export interface StoredS3CoordinatorUploadAuditEvent {
  error: OlosError;
  eventType: "upload.rejected";
  /** Slot's configured maximum object size, in bytes. */
  maxBytes: number;
  objectKey: string;
  /** Size reported by S3 for the offending object, in bytes. */
  observedBytes: number;
  /** ISO 8601 timestamp of the rejected completion attempt. */
  occurredAt: string;
  reason: "object_too_large";
  slotId: OlosId;
}

export type StoredS3CoordinatorUploadRejection = Extract<
  CoordinatorUploadCommit,
  { status: "rejected" }
> & {
  auditEvent?: StoredS3CoordinatorUploadAuditEvent;
};

export type RejectedS3CoordinatorUploadCommit = Extract<
  CoordinatorUploadCommit,
  { status: "rejected" }
>;

export type BlockedPublicationControl = Extract<
  PublicationControlResolution,
  { status: "blocked" }
>;

export type ObjectCreatedS3UploadEvent = Extract<
  UploadEventNormalization,
  { status: "object_created" }
>;

export type UploadCompletedS3UploadEvent = Extract<
  UploadEventNormalization,
  { status: "upload_completed" }
>;

export type MissingStoredS3CoordinatorUploadCommit = Extract<
  StoredS3CoordinatorUploadCommit,
  { status: "not_found" }
>;

export type StoredS3CoordinatorSlotResolution =
  | {
      slot: UploadSlot;
      status: "found";
    }
  | MissingStoredS3CoordinatorUploadCommit
  | RejectedS3CoordinatorUploadCommit;

export type MissingStoredS3CoordinatorUploadGrantIssue = Extract<
  StoredS3CoordinatorUploadGrantIssue,
  { status: "not_found" }
>;

/**
 * Result of committing an upload against a stored session. `committed` and
 * `idempotent` carry the saved snapshot's etag (and manifest artifacts when
 * requested); `rejected` carries the `olos.*` error (plus an audit event for
 * oversized objects); `conflict` means concurrent writers exhausted the
 * retry budget; `not_found` means the session does not exist.
 */
export type StoredS3CoordinatorUploadCommit =
  | (Extract<
      CoordinatorUploadCommit,
      { status: "committed" | "idempotent" }
    > & {
      etag: string;
      manifest?: StoredS3CoordinatorManifest;
    })
  | StoredS3CoordinatorUploadRejection
  | {
      current?: CoordinatorPipelineSnapshot;
      status: "conflict";
    }
  | {
      status: "not_found";
    };

/** Result of a completion; identical to a stored commit result. */
export type StoredS3CoordinatorUploadCompletion =
  StoredS3CoordinatorUploadCommit;

export type IdempotentS3CoordinatorUploadCommit = Extract<
  CoordinatorUploadCommit,
  { status: "committed" | "idempotent" }
> & { status: "idempotent" };

/**
 * Result of routing a normalized S3 upload event: a completion result for
 * events that reached the commit path, or `invalid_event` when the event
 * failed normalization.
 */
export type StoredS3CoordinatorUploadEventRoute =
  | StoredS3CoordinatorUploadCompletion
  | {
      error: OlosError;
      status: "invalid_event";
    };

/** Options for {@link issueS3CoordinatorUploadGrant}. */
export interface IssueS3CoordinatorUploadGrantOptions
  extends IssueCoordinatorSlotOptions {
  /**
   * Extra headers the uploader must send; must not override the
   * `x-amz-meta-olos-*` slot metadata headers.
   */
  additionalHeaders?: Record<string, string>;
  bucket: string;
  client: S3Client;
  /**
   * Presigned URL lifetime in seconds. The grant must not outlive the
   * slot's own `expiresAt`.
   */
  expiresInSeconds: number;
  /** Timestamp the grant expiry is computed from (default: current time). */
  now?: Date | string;
}

/** Issued slot, its presigned grant, and the updated in-memory state. */
export interface S3CoordinatorUploadGrantIssue {
  grant: UploadGrant;
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}

/** Options for {@link issueStoredS3CoordinatorUploadGrant}. */
export interface IssueStoredS3CoordinatorUploadGrantOptions
  extends Omit<IssueS3CoordinatorUploadGrantOptions, "state"> {
  /** Optimistic-concurrency retries before giving up as a conflict. */
  maxAttempts?: number;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

/**
 * Result of issuing a grant against a stored session: `saved` carries the
 * slot, grant, and saved snapshot's etag; `rejected` carries the `olos.*`
 * error (for example when publication control blocks slot issue);
 * `conflict` means concurrent writers exhausted the retry budget;
 * `not_found` means the session does not exist.
 */
export type StoredS3CoordinatorUploadGrantIssue =
  | {
      etag: string;
      grant: UploadGrant;
      slot: UploadSlot;
      state: CoordinatorPipelineState;
      status: "saved";
    }
  | {
      error: OlosError;
      state: CoordinatorPipelineState;
      status: "rejected";
    }
  | {
      current?: CoordinatorPipelineSnapshot;
      status: "conflict";
    }
  | {
      status: "not_found";
    };
