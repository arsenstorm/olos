import { fetchFor, jsonPost, normalizedBaseUrl } from "../runtime/http-client";
import {
  S3_ROUTE_ACTIONS,
  s3CompletionHintRoutePathFromOptions,
  s3RoutePathFromOptions,
} from "../runtime/route";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { S3RuntimeHttpError as S3RuntimeHttpErrorClass } from "./client-error";
import { reconciliationPayload } from "./client-reconciliation-payload";
import { reconciliationPlanPayload } from "./client-reconciliation-plan-payload";
import { parsedS3RuntimeResponse } from "./client-response";
import { retentionPayload } from "./client-retention-payload";
import type {
  S3RuntimeApplyRetentionOptions,
  S3RuntimeApplyRetentionResponse,
  S3RuntimeCommitUploadOptions,
  S3RuntimeCommitUploadResponse,
  S3RuntimeCompleteUploadOptions,
  S3RuntimeCompleteUploadResponse,
  S3RuntimeIssueUploadGrantOptions,
  S3RuntimeIssueUploadGrantResponse,
  S3RuntimePlanReconciliationOptions,
  S3RuntimeReconcileUploadsOptions,
  S3RuntimeReconcileUploadsResponse,
  S3RuntimeReconciliationPlanResponse,
} from "./client-types";
import { commitPayload, grantPayload } from "./client-upload-payload";

export type {
  S3RuntimeApplyRetentionOptions,
  S3RuntimeApplyRetentionResponse,
  S3RuntimeCommitPayload,
  S3RuntimeCommitUploadOptions,
  S3RuntimeCommitUploadResponse,
  S3RuntimeCompleteUploadOptions,
  S3RuntimeCompleteUploadResponse,
  S3RuntimeCompletionHintPayload,
  S3RuntimeHttpClientOptions,
  S3RuntimeIssueUploadGrantOptions,
  S3RuntimeIssueUploadGrantResponse,
  S3RuntimePlanReconciliationOptions,
  S3RuntimeReconcileUploadsOptions,
  S3RuntimeReconcileUploadsResponse,
  S3RuntimeReconciliationPayload,
  S3RuntimeReconciliationPlanPayload,
  S3RuntimeReconciliationPlanResponse,
  S3RuntimeRetentionPayload,
} from "./client-types";

const S3RuntimeHttpError = S3RuntimeHttpErrorClass;

export { S3RuntimeHttpError };

export async function issueS3RuntimeUploadGrant(
  options: S3RuntimeIssueUploadGrantOptions
): Promise<S3RuntimeIssueUploadGrantResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, `${S3_ROUTE_ACTIONS.slots}`),
    jsonPost(options.payload)
  );

  return parsedS3RuntimeResponse(
    response,
    "S3 upload grant issue",
    grantPayload
  );
}

export async function completeS3RuntimeUpload(
  options: S3RuntimeCompleteUploadOptions
): Promise<S3RuntimeCompleteUploadResponse> {
  const response = await fetchFor(options)(
    completionUrl(options.baseUrl, options.sessionId, options.slotId),
    jsonPost(options.payload ?? {})
  );

  return parsedS3RuntimeResponse(
    response,
    "S3 upload completion",
    commitPayload
  );
}

export async function commitS3RuntimeUpload(
  options: S3RuntimeCommitUploadOptions
): Promise<S3RuntimeCommitUploadResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, S3_ROUTE_ACTIONS.commits),
    jsonPost(options.payload)
  );

  return parsedS3RuntimeResponse(response, "S3 upload commit", commitPayload);
}

export async function planS3RuntimeReconciliation(
  options: S3RuntimePlanReconciliationOptions
): Promise<S3RuntimeReconciliationPlanResponse> {
  const response = await fetchFor(options)(
    sessionUrl(
      options.baseUrl,
      options.sessionId,
      S3_ROUTE_ACTIONS.reconcilePlan
    ),
    jsonPost(options.payload ?? {})
  );

  return parsedS3RuntimeResponse(
    response,
    "S3 reconciliation plan",
    reconciliationPlanPayload
  );
}

export async function reconcileS3RuntimeUploads(
  options: S3RuntimeReconcileUploadsOptions
): Promise<S3RuntimeReconcileUploadsResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, S3_ROUTE_ACTIONS.reconcile),
    jsonPost(options.payload)
  );

  return parsedS3RuntimeResponse(
    response,
    "S3 upload reconciliation",
    reconciliationPayload
  );
}

export async function applyS3RuntimeRetention(
  options: S3RuntimeApplyRetentionOptions
): Promise<S3RuntimeApplyRetentionResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, S3_ROUTE_ACTIONS.retention),
    jsonPost(options.payload)
  );

  return parsedS3RuntimeResponse(response, "S3 retention", retentionPayload);
}

function sessionUrl(baseUrl: string, sessionId: string, action: string): URL {
  assertUrlSafeIdentifier(sessionId, "sessionId");

  return new URL(
    s3RoutePathFromOptions(sessionId, action, {}),
    normalizedBaseUrl(baseUrl)
  );
}

function completionUrl(
  baseUrl: string,
  sessionId: string,
  slotId: string
): URL {
  assertUrlSafeIdentifier(sessionId, "sessionId");
  assertUrlSafeIdentifier(slotId, "slotId");

  return new URL(
    s3CompletionHintRoutePathFromOptions(sessionId, slotId, {}),
    normalizedBaseUrl(baseUrl)
  );
}
