import type { RuntimeHttpClientOptions } from "../runtime/client-types";
import type { RuntimeSlotIssuePayload } from "../runtime/slot-issue-payload";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import type {
  StoredS3CoordinatorReconciliationResponse,
  StoredS3CoordinatorRetentionResponse,
} from "./http-types";
import type { StoredS3CoordinatorReconciliationPlan } from "./reconciliation";

/**
 * Connection options shared by all S3 runtime client calls: the runtime's
 * `baseUrl` plus an optional `fetch` override for custom transports.
 */
export type S3RuntimeHttpClientOptions = RuntimeHttpClientOptions;

/** Options for `issueS3RuntimeUploadGrant`. */
export interface S3RuntimeIssueUploadGrantOptions
  extends S3RuntimeHttpClientOptions {
  payload: RuntimeSlotIssuePayload;
  sessionId: string;
}

/** Options for `completeS3RuntimeUpload`. */
export interface S3RuntimeCompleteUploadOptions
  extends S3RuntimeHttpClientOptions {
  /** Optional overrides for the completion; defaults to an empty hint. */
  payload?: S3RuntimeCompletionHintPayload;
  sessionId: string;
  slotId: string;
}

/** Options for `commitS3RuntimeUpload`. */
export interface S3RuntimeCommitUploadOptions
  extends S3RuntimeHttpClientOptions {
  payload: S3RuntimeCommitPayload;
  sessionId: string;
}

/** Options for `planS3RuntimeReconciliation`. */
export interface S3RuntimePlanReconciliationOptions
  extends S3RuntimeHttpClientOptions {
  /** Optional slot filter; omitted, the plan covers every eligible slot. */
  payload?: S3RuntimeReconciliationPlanPayload;
  sessionId: string;
}

/** Options for `reconcileS3RuntimeUploads`. */
export interface S3RuntimeReconcileUploadsOptions
  extends S3RuntimeHttpClientOptions {
  payload: S3RuntimeReconciliationPayload;
  sessionId: string;
}

/** Options for `applyS3RuntimeRetention`. */
export interface S3RuntimeApplyRetentionOptions
  extends S3RuntimeHttpClientOptions {
  payload: S3RuntimeRetentionPayload;
  sessionId: string;
}

/** JSON body posted to the runtime's `s3/commits` route. */
export interface S3RuntimeCommitPayload {
  /** Idempotency key: re-sending the same id yields an idempotent commit. */
  commitId: string;
  /** ISO 8601 timestamp recorded as the commit time. */
  committedAt: string;
  independent?: boolean;
  lateToleranceMs?: number;
  maxSegments?: number;
  /** Expected object key; the commit is rejected if it mismatches the slot. */
  objectKey?: string;
  programDateTime?: string;
  providerId?: string;
  slotId: string;
  /** S3 object version to observe instead of the latest. */
  versionId?: string;
}

/** JSON body posted to the runtime's `s3/reconcile` route. */
export interface S3RuntimeReconciliationPayload {
  /** ISO 8601 timestamp recorded on every commit the sweep produces. */
  committedAt: string;
  independent?: boolean;
  lateToleranceMs?: number;
  maxSegments?: number;
  programDateTime?: string;
  providerId?: string;
  /** Restricts the sweep to these slots; omitted, every eligible slot. */
  slotIds?: readonly string[];
  versionId?: string;
}

/** JSON body posted to the runtime's `s3/reconcile/plan` route. */
export interface S3RuntimeReconciliationPlanPayload {
  /** Restricts the plan to these slots; omitted, every eligible slot. */
  slotIds?: readonly string[];
}

/** JSON body posted to the runtime's `s3/retention` route. */
export interface S3RuntimeRetentionPayload {
  /** ISO 8601 timestamp the retention window is evaluated against. */
  now: string;
}

/**
 * Optional JSON body for the completion-hint route. Every field overrides a
 * value the runtime would otherwise derive itself (commit id, timestamps,
 * observed object metadata).
 */
export interface S3RuntimeCompletionHintPayload {
  commitId?: string;
  committedAt?: string;
  etag?: string;
  independent?: boolean;
  lateToleranceMs?: number;
  maxSegments?: number;
  objectKey?: string;
  programDateTime?: string;
  providerId?: string;
  size?: number;
  versionId?: string;
}

/** Parsed result of `issueS3RuntimeUploadGrant`, plus the raw `Response`. */
export interface S3RuntimeIssueUploadGrantResponse {
  grant: UploadGrant;
  response: Response;
  slot: UploadSlot;
}

/** Parsed result of `completeS3RuntimeUpload`; same shape as a commit. */
export type S3RuntimeCompleteUploadResponse = S3RuntimeCommitUploadResponse;

/** Parsed result of `commitS3RuntimeUpload`, plus the raw `Response`. */
export interface S3RuntimeCommitUploadResponse {
  commit: Commit;
  /** Present when the commit advanced the session's published cursor. */
  cursor?: Cursor;
  response: Response;
}

/** Parsed result of `planS3RuntimeReconciliation`, plus the raw `Response`. */
export type S3RuntimeReconciliationPlanResponse =
  StoredS3CoordinatorReconciliationPlan & {
    response: Response;
  };

/** Parsed result of `reconcileS3RuntimeUploads`, plus the raw `Response`. */
export type S3RuntimeReconcileUploadsResponse =
  StoredS3CoordinatorReconciliationResponse & {
    response: Response;
  };

/** Parsed result of `applyS3RuntimeRetention`, plus the raw `Response`. */
export type S3RuntimeApplyRetentionResponse =
  StoredS3CoordinatorRetentionResponse & {
    response: Response;
  };
