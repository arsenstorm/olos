import {
  isSuccessfulCommitStatus,
  type SuccessfulCommitStatus,
} from "../runtime/commit-status";
import { jsonErrorResponse } from "../runtime/response";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type {
  StoredS3CoordinatorCommitResponse,
  StoredS3CoordinatorEventRouteResponseResult,
  StoredS3CoordinatorReconciliationResponse,
  StoredS3CoordinatorReconciliationResponseResult,
  StoredS3CoordinatorRouteError,
} from "./http";
import {
  type StoredS3CoordinatorUploadReconciliationResult,
  summarizeStoredS3CoordinatorUploadReconciliation,
} from "./reconciliation";

export function isSuccessfulS3MutationResult<Result extends { status: string }>(
  result: Result
): result is Extract<Result, { status: SuccessfulCommitStatus }> {
  return isSuccessfulCommitStatus(result.status);
}

export function optionalCursorResponse(
  cursor: Cursor | undefined
): Pick<StoredS3CoordinatorCommitResponse, "cursor"> | Record<string, never> {
  return cursor === undefined ? {} : { cursor };
}

export function s3ResponseNotFound(): Response {
  return jsonErrorResponse("coordinator session was not found", 404);
}

export function s3ResponseConflict(): Response {
  return jsonErrorResponse("coordinator session changed during mutation", 409);
}

export function eventRouteResult(result: {
  status: string;
  commit?: Commit;
  error?: { error: StoredS3CoordinatorRouteError };
  auditEvent?: unknown;
}): StoredS3CoordinatorEventRouteResponseResult {
  if (isSuccessfulS3MutationResult(result)) {
    return {
      commit: result.commit,
      status: result.status,
    };
  }

  if (result.status === "invalid_event") {
    return {
      error: result.error?.error as StoredS3CoordinatorRouteError,
      status: "invalid_event",
    };
  }

  if (result.status === "rejected") {
    return {
      ...rejectionBody(result),
      error: result.error?.error as StoredS3CoordinatorRouteError,
      status: "rejected",
    };
  }

  return { status: result.status as "conflict" | "not_found" };
}

export function rejectionBody(
  result: { error: { error: Record<string, unknown> } } & {
    auditEvent?: unknown;
  }
): Record<string, unknown> {
  return {
    ...result.error,
    ...(result.auditEvent === undefined
      ? {}
      : { auditEvent: result.auditEvent }),
  };
}

export function summarizeReconciliationResult(result: {
  status: "failed" | "succeeded";
  results: StoredS3CoordinatorUploadReconciliationResult[];
}): StoredS3CoordinatorReconciliationResponse["summary"] {
  return summarizeStoredS3CoordinatorUploadReconciliation(result);
}

export function reconciliationResult(
  result: StoredS3CoordinatorUploadReconciliationResult
): StoredS3CoordinatorReconciliationResponseResult {
  if (isSuccessfulS3MutationResult(result)) {
    return {
      commit: result.commit.commit,
      ...optionalCursorResponse(result.commit.cursor),
      slotId: result.slot.slotId,
      status: result.status,
    };
  }

  if (result.status === "failed") {
    if (result.result?.status === "rejected") {
      return {
        error: result.result.error.error,
        slotId: result.slot.slotId,
        status: result.status,
      };
    }

    return {
      ...(result.error === undefined
        ? {}
        : { error: { message: result.error } }),
      ...(result.result === undefined
        ? {}
        : { resultStatus: result.result.status }),
      slotId: result.slot.slotId,
      status: result.status,
    };
  }

  throw new Error("unsupported S3 reconciliation result status");
}
