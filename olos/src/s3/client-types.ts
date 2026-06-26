import type { RuntimeFetch } from "../runtime/client";
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

export interface S3RuntimeHttpClientOptions {
  baseUrl: string;
  fetch?: RuntimeFetch;
}

export interface S3RuntimeIssueUploadGrantOptions
  extends S3RuntimeHttpClientOptions {
  payload: RuntimeSlotIssuePayload;
  sessionId: string;
}

export interface S3RuntimeCompleteUploadOptions
  extends S3RuntimeHttpClientOptions {
  payload?: S3RuntimeCompletionHintPayload;
  sessionId: string;
  slotId: string;
}

export interface S3RuntimeCommitUploadOptions
  extends S3RuntimeHttpClientOptions {
  payload: S3RuntimeCommitPayload;
  sessionId: string;
}

export interface S3RuntimePlanReconciliationOptions
  extends S3RuntimeHttpClientOptions {
  payload?: S3RuntimeReconciliationPlanPayload;
  sessionId: string;
}

export interface S3RuntimeReconcileUploadsOptions
  extends S3RuntimeHttpClientOptions {
  payload: S3RuntimeReconciliationPayload;
  sessionId: string;
}

export interface S3RuntimeApplyRetentionOptions
  extends S3RuntimeHttpClientOptions {
  payload: S3RuntimeRetentionPayload;
  sessionId: string;
}

export interface S3RuntimeCommitPayload {
  commitId: string;
  committedAt: string;
  independent?: boolean;
  lateToleranceMs?: number;
  maxSegments?: number;
  objectKey?: string;
  programDateTime?: string;
  providerId?: string;
  slotId: string;
  versionId?: string;
}

export interface S3RuntimeReconciliationPayload {
  committedAt: string;
  independent?: boolean;
  lateToleranceMs?: number;
  maxSegments?: number;
  programDateTime?: string;
  providerId?: string;
  slotIds?: readonly string[];
  versionId?: string;
}

export interface S3RuntimeReconciliationPlanPayload {
  slotIds?: readonly string[];
}

export interface S3RuntimeRetentionPayload {
  now: string;
}

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

export interface S3RuntimeIssueUploadGrantResponse {
  grant: UploadGrant;
  response: Response;
  slot: UploadSlot;
}

export interface S3RuntimeCompleteUploadResponse {
  commit: Commit;
  cursor?: Cursor;
  response: Response;
}

export interface S3RuntimeCommitUploadResponse {
  commit: Commit;
  cursor?: Cursor;
  response: Response;
}

export type S3RuntimeReconciliationPlanResponse =
  StoredS3CoordinatorReconciliationPlan & {
    response: Response;
  };

export type S3RuntimeReconcileUploadsResponse =
  StoredS3CoordinatorReconciliationResponse & {
    response: Response;
  };

export type S3RuntimeApplyRetentionResponse =
  StoredS3CoordinatorRetentionResponse & {
    response: Response;
  };
