import type { CoordinatorRetentionPlan } from "../protocol";
import type {
  RetiredCoordinatorObjectDeletionResult,
  RetiredCoordinatorObjectDeletionSummary,
} from "../runtime";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { OlosErrorCode } from "../types/errors";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import type { summarizeStoredS3CoordinatorUploadReconciliation } from "./reconciliation";

export interface StoredS3CoordinatorSlotGrantResponse {
  grant: UploadGrant;
  slot: UploadSlot;
}

export interface StoredS3CoordinatorCommitResponse {
  commit: Commit;
  cursor?: Cursor;
}

export interface StoredS3CoordinatorEventRouteResponse {
  results: readonly StoredS3CoordinatorEventRouteResponseResult[];
}

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

export interface StoredS3CoordinatorRetentionResponse {
  plan: CoordinatorRetentionPlan;
  result: RetiredCoordinatorObjectDeletionResult;
  summary: RetiredCoordinatorObjectDeletionSummary;
}

export interface StoredS3CoordinatorReconciliationResponse {
  results: readonly StoredS3CoordinatorReconciliationResponseResult[];
  summary: ReturnType<typeof summarizeStoredS3CoordinatorUploadReconciliation>;
}

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

export interface StoredS3CoordinatorRouteError {
  code?: OlosErrorCode;
  details?: Record<string, unknown>;
  message: string;
}
