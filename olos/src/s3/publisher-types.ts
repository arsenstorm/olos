import type { S3Client } from "@aws-sdk/client-s3";
import type {
  CoordinatorCommitPolicy,
  CoordinatorPipelineStore,
} from "../protocol/coordinator-types";
import type { RuntimePublisherHeartbeatResult } from "../runtime/publisher";
import type {
  CreateRuntimePublisherNextObjectPlanOptions,
  RuntimePublisherObjectPosition,
} from "../runtime/publisher-cadence";
import type { RuntimePublisherObjectExpiry } from "../runtime/publisher-expiry";
import type {
  CreateRuntimePublisherObjectPlanOptions,
  RuntimePublisherObjectPlan,
} from "../runtime/publisher-plan";
import type { PublicationControlPolicy } from "../state/publication-control";
import type { OlosErrorCode } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { ProfileData } from "../types/profile";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import type {
  commitStoredS3CoordinatorUpload,
  issueStoredS3CoordinatorUploadGrant,
} from "./coordinator-grant";
import type {
  StoredS3CoordinatorManifestOptions,
  StoredS3CoordinatorUploadCommit,
  StoredS3CoordinatorUploadGrantIssue,
} from "./coordinator-types";
import type { S3HeadObjectClient } from "./object-observation";
/**
 * Callbacks for {@link runStoredS3PublisherUploadStep}; each maps to one
 * phase of the heartbeat, issue, upload, commit pipeline.
 */
export interface RunStoredS3PublisherUploadStepOptions {
  /** Commits the uploaded object for the issued slot. */
  commit(slot: UploadSlot): Promise<StoredS3CoordinatorUploadCommit>;
  /**
   * Optional lease check run first; any result other than `refreshed`
   * aborts the step as `heartbeat_failed`.
   */
  heartbeat?(): Promise<RuntimePublisherHeartbeatResult>;
  /** Issues the upload slot and its presigned grant. */
  issueGrant(): Promise<StoredS3CoordinatorUploadGrantIssue>;
  /** Uploads the object bytes using the issued grant. */
  upload(grant: UploadGrant): Promise<void>;
}

/** Options for {@link runPlannedStoredS3PublisherUploadStep}. */
export interface RunPlannedStoredS3PublisherUploadStepOptions {
  additionalHeaders?: Record<string, string>;
  bucket: string;
  /**
   * Seconds the planned object is expected to cover; feeds the grant expiry
   * together with `targetLatency`.
   */
  cadenceSeconds: number;
  client: S3Client;
  commitPolicy?: CoordinatorCommitPolicy;
  committedAt: string;
  headObjectClient?: S3HeadObjectClient;
  heartbeat?(): Promise<RuntimePublisherHeartbeatResult>;
  lateToleranceMs?: number;
  manifest?: StoredS3CoordinatorManifestOptions;
  maxAttempts?: number;
  maxSegments?: number;
  /**
   * Floor for the grant TTL in seconds (default: the low-latency profile's
   * minimum upload TTL).
   */
  minTtlSeconds?: number;
  now: Date | string;
  /** Object plan minus `expiresAt`, which the step derives itself. */
  plan: Omit<CreateRuntimePublisherObjectPlanOptions, "expiresAt">;
  /**
   * Profile-defined facts recorded on the commit; merged over the slot's
   * own `profile` (commit values win per key).
   */
  profile?: ProfileData;
  providerId: string;
  publicationControl?: PublicationControlPolicy;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
  /**
   * Target publish latency in seconds; the grant TTL is at least
   * `cadenceSeconds` plus this value.
   */
  targetLatency: number;
  /** Uploads the object bytes for the planned object. */
  upload(grant: UploadGrant, plan: RuntimePublisherObjectPlan): Promise<void>;
  versionId?: string;
}

/** Options for {@link runNextStoredS3PublisherUploadStep}. */
export interface RunNextStoredS3PublisherUploadStepOptions
  extends Omit<
      RunPlannedStoredS3PublisherUploadStepOptions,
      "cadenceSeconds" | "minTtlSeconds" | "plan" | "targetLatency"
    >,
    CreateRuntimePublisherNextObjectPlanOptions {}

/**
 * Outcome of one publisher upload step. `committed`/`idempotent` carry the
 * full pipeline artifacts; the failure variants identify which phase broke
 * (`heartbeat_failed`, `issue_failed`, `upload_failed`, `commit_failed`)
 * along with whatever the earlier phases produced.
 */
export type StoredS3PublisherUploadStep =
  | {
      commit: StoredS3CoordinatorUploadCommit;
      grant: UploadGrant;
      heartbeat?: RuntimePublisherHeartbeatResult;
      slot: UploadSlot;
      status: "committed" | "idempotent";
    }
  | {
      error?: string;
      heartbeat?: RuntimePublisherHeartbeatResult;
      status: "heartbeat_failed";
    }
  | {
      error?: string;
      heartbeat?: RuntimePublisherHeartbeatResult;
      issue?: Exclude<StoredS3CoordinatorUploadGrantIssue, { status: "saved" }>;
      status: "issue_failed";
    }
  | {
      error: string;
      grant: UploadGrant;
      heartbeat?: RuntimePublisherHeartbeatResult;
      slot: UploadSlot;
      status: "upload_failed";
    }
  | {
      commit?: StoredS3CoordinatorUploadCommit;
      error?: string;
      grant: UploadGrant;
      heartbeat?: RuntimePublisherHeartbeatResult;
      slot: UploadSlot;
      status: "commit_failed";
    };

export type SuccessfulStoredS3PublisherUploadStep = Extract<
  StoredS3PublisherUploadStep,
  { status: "committed" | "idempotent" }
>;

export type FailedStoredS3PublisherIssueStep = Extract<
  StoredS3PublisherUploadStep,
  { status: "issue_failed" }
>;

export type FailedStoredS3PublisherUploadObjectStep = Extract<
  StoredS3PublisherUploadStep,
  { status: "upload_failed" }
>;

export type FailedStoredS3PublisherCommitStep = Extract<
  StoredS3PublisherUploadStep,
  { status: "commit_failed" }
>;

export type StoredS3PublisherErrorCodeResult =
  | StoredS3CoordinatorUploadCommit
  | Exclude<StoredS3CoordinatorUploadGrantIssue, { status: "saved" }>;

export type RejectedStoredS3PublisherErrorCodeResult = Extract<
  StoredS3PublisherErrorCodeResult,
  { status: "rejected" }
>;

export type SavedStoredS3CoordinatorUploadGrantIssue = Extract<
  StoredS3CoordinatorUploadGrantIssue,
  { status: "saved" }
>;

export type StoredS3PublisherObjectPlanStepOptions = Omit<
  RunPlannedStoredS3PublisherUploadStepOptions,
  "cadenceSeconds" | "plan"
> & {
  expiry: RuntimePublisherObjectExpiry;
  plan: RuntimePublisherObjectPlan;
};

export type StoredS3PublisherCommitUploadOptions = Parameters<
  typeof commitStoredS3CoordinatorUpload
>[0];

export type StoredS3PublisherGrantIssueOptions = Parameters<
  typeof issueStoredS3CoordinatorUploadGrant
>[0];

export type ReadyStoredS3PublisherHeartbeat =
  | RuntimePublisherHeartbeatResult
  | undefined;

export const SUCCESSFUL_STORED_S3_PUBLISHER_STEP_STATUSES = [
  "committed",
  "idempotent",
] as const satisfies readonly SuccessfulStoredS3PublisherUploadStep["status"][];

/** Step outcome plus the object plan and grant expiry the step ran with. */
export type PlannedStoredS3PublisherUploadStep = StoredS3PublisherUploadStep & {
  expiry: RuntimePublisherObjectExpiry;
  plan: RuntimePublisherObjectPlan;
};

/** Planned step outcome plus the cadence position of the published object. */
export type NextStoredS3PublisherUploadStep =
  PlannedStoredS3PublisherUploadStep & {
    position: RuntimePublisherObjectPosition;
  };

/**
 * Flat, log-friendly digest of a publisher step produced by
 * {@link summarizeStoredS3PublisherUploadStep}. `ok` is true only for
 * `committed` and `idempotent` steps; `errorCode` surfaces the `olos.*`
 * code when a commit or grant issue was rejected.
 */
export interface StoredS3PublisherUploadStepSummary {
  commitId?: OlosId;
  commitStatus?: StoredS3CoordinatorUploadCommit["status"];
  error?: string;
  errorCode?: OlosErrorCode;
  heartbeatStatus?: RuntimePublisherHeartbeatResult["status"];
  issueStatus?: Exclude<
    StoredS3CoordinatorUploadGrantIssue,
    { status: "saved" }
  >["status"];
  objectKey?: string;
  ok: boolean;
  slotId?: OlosId;
  status: StoredS3PublisherUploadStep["status"];
}
