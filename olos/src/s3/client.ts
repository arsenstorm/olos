import {
  fetchFor,
  jsonPost,
  normalizedBaseUrl,
  responseBody,
} from "../runtime/http-client";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { S3RuntimeHttpError } from "./client-error";
import { commitPayload, grantPayload } from "./client-payload";
import { reconciliationPayload } from "./client-payload-reconciliation";
import { reconciliationPlanPayload } from "./client-payload-reconciliation-plan";
import { retentionPayload } from "./client-payload-retention";
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
import {
  S3_ROUTE_ACTIONS,
  s3CompletionHintRoutePath,
  s3RoutePath,
} from "./route";

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

/**
 * Ask a stored S3 coordinator runtime to issue an upload slot with a
 * presigned S3 PUT grant by POSTing to the session's `s3/slots` route.
 * Resolves with the issued slot, the grant, and the raw `Response`; throws
 * `S3RuntimeHttpError` (carrying the response and its parsed body, including
 * the `olos.*` `error.code`) on any non-2xx status.
 */
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

/**
 * Report that a slot's object finished uploading by POSTing a completion
 * hint to the session's `upload-slots/{slotId}/complete` route. The runtime
 * verifies the object via S3 `HeadObject` and commits it; the payload is
 * optional and only supplies overrides such as `commitId` or `committedAt`.
 * Resolves with the resulting commit (and cursor when publication advanced);
 * throws `S3RuntimeHttpError` on any non-2xx status.
 */
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

/**
 * Commit an uploaded slot by POSTing to the session's `s3/commits` route.
 * The runtime observes the object with S3 `HeadObject` and applies the
 * commit; re-sending the same `commitId` is idempotent (HTTP 200 instead of
 * 201). Resolves with the commit (and cursor when publication advanced);
 * throws `S3RuntimeHttpError` on any non-2xx status.
 */
export async function commitS3RuntimeUpload(
  options: S3RuntimeCommitUploadOptions
): Promise<S3RuntimeCommitUploadResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, S3_ROUTE_ACTIONS.commits),
    jsonPost(options.payload)
  );

  return parsedS3RuntimeResponse(response, "S3 upload commit", commitPayload);
}

/**
 * Dry-run reconciliation for a session by POSTing to the runtime's
 * `s3/reconcile-plan` route. Returns the slots that a subsequent
 * {@link reconcileS3RuntimeUploads} call would attempt to commit without
 * mutating anything. Throws `S3RuntimeHttpError` on any non-2xx status,
 * including 404 when the session is unknown.
 */
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

/**
 * Reconcile a session's unresolved slots by POSTing to the runtime's
 * `s3/reconcile` route. The runtime attempts to commit each issued or
 * upload-observed slot (optionally narrowed via `payload.slotIds`) and
 * responds 202 with per-slot results plus an aggregate summary — individual
 * slot failures are reported there, not thrown. Throws `S3RuntimeHttpError`
 * only for non-2xx responses such as an unknown session.
 */
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

/**
 * Run a retention sweep for a session by POSTing to the runtime's
 * `s3/retention` route. The runtime prunes commits older than the window at
 * `payload.now`, saves the pruned state, then deletes the retired objects
 * from S3, responding 202 with the plan, the per-object deletion result, and
 * a summary (delete failures are summarized, not thrown). Throws
 * `S3RuntimeHttpError` for non-2xx responses.
 */
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

  return new URL(s3RoutePath(sessionId, action), normalizedBaseUrl(baseUrl));
}

function completionUrl(
  baseUrl: string,
  sessionId: string,
  slotId: string
): URL {
  assertUrlSafeIdentifier(sessionId, "sessionId");
  assertUrlSafeIdentifier(slotId, "slotId");

  return new URL(
    s3CompletionHintRoutePath(sessionId, slotId),
    normalizedBaseUrl(baseUrl)
  );
}

async function s3RuntimeHttpError(
  operation: string,
  response: Response
): Promise<S3RuntimeHttpError> {
  return new S3RuntimeHttpError(
    `${operation} failed with status ${response.status}`,
    response,
    await responseBody(response)
  );
}

async function parsedS3RuntimeResponse<Payload extends object>(
  response: Response,
  operation: string,
  parsePayload: (value: unknown) => Payload
): Promise<Payload & { response: Response }> {
  if (!response.ok) {
    throw await s3RuntimeHttpError(operation, response);
  }

  return {
    ...parsePayload(await response.json()),
    response,
  };
}
