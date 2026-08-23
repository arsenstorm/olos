import {
  isSuccessfulCommitStatus,
  type SuccessfulCommitStatus,
} from "../runtime/commit-status";
import { optionalField } from "../runtime/request-fields";
import { jsonConflictResponse } from "../runtime/response";
import type { Commit } from "../types/commit";
import type { OlosError } from "../types/errors";
import type { StoredS3CoordinatorUploadEventRoute } from "./coordinator-types";
import type {
  StoredS3CoordinatorEventRouteResponseResult,
  StoredS3CoordinatorReconciliationResponseResult,
  StoredS3CoordinatorRouteError,
} from "./http-types";
import type { StoredS3CoordinatorUploadReconciliationResult } from "./reconciliation";

export function isSuccessfulS3MutationResult<Result extends { status: string }>(
  result: Result
): result is Extract<Result, { status: SuccessfulCommitStatus }> {
  return isSuccessfulCommitStatus(result.status);
}

export function s3ResponseConflict(): Response {
  return jsonConflictResponse("coordinator session changed during mutation");
}

export function eventRouteResult(
  result: StoredS3CoordinatorUploadEventRoute
): StoredS3CoordinatorEventRouteResponseResult {
  switch (result.status) {
    // biome-ignore lint/suspicious/noUnnecessaryConditions: StoredS3CoordinatorUploadCommit is built with Extract<>, which biome cannot evaluate, so it misreads the commit statuses as unreachable.
    case "committed":
    // biome-ignore lint/suspicious/noUnnecessaryConditions: same Extract<> limitation as the case above.
    case "idempotent":
      return successfulEventRouteResult(result.commit, result.status);
    case "invalid_event":
      return invalidEventRouteResult(result.error);
    // biome-ignore lint/suspicious/noUnnecessaryConditions: same Extract<> limitation as the cases above.
    case "rejected":
      return rejectedEventRouteResult(result);
    case "conflict":
    case "not_found":
      return { status: result.status };
    default:
      return unsupportedEventRouteStatus(result);
  }
}

function unsupportedEventRouteStatus(
  _result: never
): StoredS3CoordinatorEventRouteResponseResult {
  throw new Error("unsupported S3 event route status");
}

function successfulEventRouteResult(
  commit: Commit,
  status: SuccessfulCommitStatus
): StoredS3CoordinatorEventRouteResponseResult {
  return { commit, status };
}

function invalidEventRouteResult(
  error: OlosError
): StoredS3CoordinatorEventRouteResponseResult {
  return {
    error: error.error,
    status: "invalid_event",
  };
}

function rejectedEventRouteResult(
  result: Extract<StoredS3CoordinatorUploadEventRoute, { status: "rejected" }>
): StoredS3CoordinatorEventRouteResponseResult {
  if (result.error === undefined) {
    return {
      error: {
        code: "olos.invalid_state",
        message: "S3 route rejected without error details",
      },
      status: "rejected",
    };
  }

  return {
    ...rejectionBody({
      auditEvent: result.auditEvent,
      error: result.error,
    }),
    error: result.error.error,
    status: "rejected",
  };
}

export function rejectionBody(
  result: { error: { error: StoredS3CoordinatorRouteError } } & {
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

export function reconciliationResult(
  result: StoredS3CoordinatorUploadReconciliationResult
): StoredS3CoordinatorReconciliationResponseResult {
  if (isSuccessfulS3MutationResult(result)) {
    return successfulReconciliationResult(result);
  }

  if (result.status === "failed") {
    return failedReconciliationResult(result);
  }

  throw new Error("unsupported S3 reconciliation result status");
}

function successfulReconciliationResult(
  result: Extract<
    StoredS3CoordinatorUploadReconciliationResult,
    { status: SuccessfulCommitStatus }
  >
): StoredS3CoordinatorReconciliationResponseResult {
  return {
    commit: result.commit.commit,
    ...optionalField("cursor", result.commit.cursor),
    slotId: result.slot.slotId,
    status: result.status,
  };
}

function failedReconciliationResult(
  result: Extract<
    StoredS3CoordinatorUploadReconciliationResult,
    { status: "failed" }
  >
): StoredS3CoordinatorReconciliationResponseResult {
  return {
    ...failedReconciliationFailureDetails(result),
    slotId: result.slot.slotId,
    status: result.status,
  };
}

function failedReconciliationFailureDetails(
  result: Extract<
    StoredS3CoordinatorUploadReconciliationResult,
    { status: "failed" }
  >
): Partial<{
  error: StoredS3CoordinatorRouteError;
  resultStatus: string;
}> {
  if (result.result?.status === "rejected") {
    return { error: result.result.error.error };
  }

  return {
    ...failedReconciliationErrorResponse(result.error),
    ...failedReconciliationResultStatusResponse(result.result),
  };
}

function failedReconciliationErrorResponse(
  error: string | undefined
): Partial<{ error: StoredS3CoordinatorRouteError }> {
  return error === undefined
    ? {}
    : { error: { code: "olos.invalid_state", message: error } };
}

function failedReconciliationResultStatusResponse(
  result: Extract<
    StoredS3CoordinatorUploadReconciliationResult,
    { status: "failed" }
  >["result"]
): Partial<{ resultStatus: string }> {
  return result === undefined ? {} : { resultStatus: result.status };
}
