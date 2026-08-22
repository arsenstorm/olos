import type { S3Client } from "@aws-sdk/client-s3";
import type { CoordinatorRetentionPlan } from "../protocol/coordinator-types";
import type { CreateStoredCoordinatorRuntimeHandlerOptions } from "../runtime/http-types";
import type {
  RetiredCoordinatorObjectDeletionResult,
  RetiredCoordinatorObjectDeletionSummary,
} from "../runtime/retention";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { OlosErrorCode } from "../types/errors";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import type { S3HeadObjectClient } from "./object-observation";
import type { summarizeStoredS3CoordinatorUploadReconciliation } from "./reconciliation";
import type { S3DeleteObjectClient } from "./retention";

/** Options for `createStoredS3CoordinatorRuntimeHandler`. */
export interface CreateStoredS3CoordinatorRuntimeHandlerOptions
  extends CreateStoredCoordinatorRuntimeHandlerOptions {
  /**
   * Extra headers required on uploads; must not override the
   * `x-amz-meta-olos-*` slot metadata headers.
   */
  additionalHeaders?: Record<string, string>;
  bucket: string;
  /** Full S3 client used to presign grants (and as the default for the
   * narrower `objectClient`/`retentionClient` roles). */
  client: S3Client;
  /**
   * Derives the commit id for a completion hint that supplies none
   * (default: `complete_{slotId}`).
   */
  completionHintCommitId?: (slotId: string) => string;
  /** Timestamp source for completion hints (default: current time). */
  completionHintNow?: () => Date | string;
  /** Presigned grant lifetime in seconds; must be positive. */
  expiresInSeconds: number;
  /** Timestamp source for grant expiry (default: current time). */
  grantNow?: () => Date | string;
  lateToleranceMs?: number;
  /** Narrow HeadObject client for commit verification (default: `client`). */
  objectClient?: S3HeadObjectClient;
  /**
   * Receives the underlying error for failures the handler reports
   * opaquely — completion-hint observation failures and reconciliation
   * throws — so deployments can log them.
   */
  onError?: (
    error: unknown,
    context: { route: string; sessionId: string }
  ) => void;
  /** Provider id for S3 event routes; without it `s3/events` returns 400. */
  providerId?: string;
  /** Narrow DeleteObject client for retention sweeps (default: `client`). */
  retentionClient?: S3DeleteObjectClient;
}

/** 201 response body of the S3 slot grant route. */
export interface StoredS3CoordinatorSlotGrantResponse {
  grant: UploadGrant;
  slot: UploadSlot;
}

/** Response body of the S3 commit and completion-hint routes. */
export interface StoredS3CoordinatorCommitResponse {
  commit: Commit;
  /** Present when the commit advanced the session's published cursor. */
  cursor?: Cursor;
}

/** 202 response body of the S3 event route: one result per event record. */
export interface StoredS3CoordinatorEventRouteResponse {
  results: readonly StoredS3CoordinatorEventRouteResponseResult[];
}

/**
 * Outcome of routing one S3 event record: the resulting commit, an error for
 * invalid or rejected events, or a bare `conflict`/`not_found` status.
 */
export type StoredS3CoordinatorEventRouteResponseResult =
  | {
      commit: Commit;
      status: "committed" | "idempotent";
    }
  | {
      auditEvent?: unknown;
      error: StoredS3CoordinatorRouteError;
      status: "invalid_event" | "rejected";
    }
  | {
      status: "conflict" | "not_found";
    };

/**
 * 202 response body of the S3 retention route: the pruning plan, the
 * per-object S3 delete outcomes, and their aggregate summary.
 */
export interface StoredS3CoordinatorRetentionResponse {
  plan: CoordinatorRetentionPlan;
  /** Which retired objects were deleted from S3 and which deletes failed. */
  result: RetiredCoordinatorObjectDeletionResult;
  summary: RetiredCoordinatorObjectDeletionSummary;
}

/**
 * 202 response body of the S3 reconciliation route: one result per planned
 * slot plus an aggregate summary (`summary.ok` is false when any failed).
 */
export interface StoredS3CoordinatorReconciliationResponse {
  results: readonly StoredS3CoordinatorReconciliationResponseResult[];
  summary: ReturnType<typeof summarizeStoredS3CoordinatorUploadReconciliation>;
}

/**
 * Outcome of reconciling one slot: the commit it produced, or a `failed`
 * entry carrying the rejection error and/or the underlying result status.
 */
export type StoredS3CoordinatorReconciliationResponseResult =
  | {
      commit: Commit;
      cursor?: Cursor;
      slotId: string;
      status: "committed" | "idempotent";
    }
  | {
      error?: StoredS3CoordinatorRouteError;
      resultStatus?: string;
      slotId: string;
      status: "failed";
    };

/**
 * Error shape embedded in S3 route response bodies; `code` is one of the
 * `olos.*` error codes.
 */
export interface StoredS3CoordinatorRouteError {
  code: OlosErrorCode;
  details?: Record<string, unknown>;
  message: string;
}
