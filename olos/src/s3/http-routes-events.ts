import { rejectionStatusCode } from "../runtime/rejection-status";
import {
  jsonBadRequestResponse,
  jsonErrorResponse,
  jsonResponse,
} from "../runtime/response";
import {
  applyStoredCoordinatorRetention,
  summarizeRetiredCoordinatorObjectDeletions,
} from "../runtime/retention";
import type { Cursor } from "../types/cursor";
import { isRecord } from "../validation/fields";
import {
  type completeStoredS3CoordinatorUpload,
  routeStoredS3CoordinatorUploadEvent,
} from "./coordinator-event";
import { normalizeS3ObjectCreatedEvents } from "./event";
import type { StoredS3CoordinatorRuntimeHandlerContext } from "./http";
import {
  parseJsonRequest,
  parseS3ReconciliationPlanRequest,
  parseS3ReconciliationRequest,
  parseS3RetentionRequest,
} from "./http-request-parser";
import {
  eventRouteResult,
  isSuccessfulS3MutationResult,
  optionalCursorResponse,
  reconciliationResult,
  rejectionBody,
  s3ResponseConflict,
  s3ResponseNotFound,
} from "./http-response";
import type {
  CreateStoredS3CoordinatorRuntimeHandlerOptions,
  StoredS3CoordinatorCommitResponse,
  StoredS3CoordinatorEventRouteResponse,
  StoredS3CoordinatorEventRouteResponseResult,
  StoredS3CoordinatorReconciliationResponse,
  StoredS3CoordinatorRetentionResponse,
} from "./http-types";
import type { StoredS3CoordinatorUploadReconciliationResult } from "./reconciliation";
import {
  reconcileStoredS3CoordinatorUploads,
  summarizeStoredS3CoordinatorUploadReconciliation,
} from "./reconciliation";
import { planStoredS3CoordinatorReconciliation } from "./reconciliation-summary";
import { deleteRetiredS3CoordinatorObjects } from "./retention";

/** Provider event batches beyond this size are rejected before routing. */
const MAX_S3_EVENT_RECORDS = 1000;

/**
 * Turn an invalid S3 request parse into its response: 413
 * `olos.invalid_request` when the body exceeded `maxBodyBytes`, otherwise
 * the usual 400.
 */
function invalidS3RequestResponse(parsed: {
  message: string;
  tooLarge?: true;
}): Response {
  return parsed.tooLarge
    ? jsonErrorResponse("olos.invalid_request", parsed.message, 413)
    : jsonBadRequestResponse(parsed.message);
}

export async function scheduleRetiredObjectDeletes(
  result: Awaited<ReturnType<typeof completeStoredS3CoordinatorUpload>>,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions,
  ctx: StoredS3CoordinatorRuntimeHandlerContext | undefined
): Promise<void> {
  if (!isSuccessfulS3MutationResult(result)) {
    return;
  }

  const objects = result.retiredObjects;
  if (objects === undefined || objects.length === 0) {
    return;
  }

  const work = deleteRetiredS3CoordinatorObjects({
    bucket: options.bucket,
    client: options.retentionClient ?? options.client,
    objects,
  });

  if (ctx === undefined) {
    await work;
    return;
  }

  ctx.waitUntil(work);
}

export function s3CommitResponse(
  result: Awaited<ReturnType<typeof completeStoredS3CoordinatorUpload>>,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Response {
  if (isSuccessfulS3MutationResult(result)) {
    notifyCursor(options.cursorNotifier, result.cursor);

    const body: StoredS3CoordinatorCommitResponse = {
      commit: result.commit,
      ...optionalCursorResponse(result.cursor),
    };

    return jsonResponse(body, result.status === "committed" ? 201 : 200);
  }

  if (result.status === "rejected") {
    return jsonResponse(
      rejectionBody(result),
      rejectionStatusCode(result.error.error.code)
    );
  }

  if (result.status === "not_found") {
    return s3ResponseNotFound();
  }

  return s3ResponseConflict();
}

function notifyCursor(
  notifier:
    | CreateStoredS3CoordinatorRuntimeHandlerOptions["cursorNotifier"]
    | undefined,
  cursor: Cursor | undefined
): void {
  if (notifier !== undefined && cursor !== undefined) {
    notifier.notify(cursor);
  }
}

export async function handleS3Events(
  request: Request,
  sessionId: string,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions,
  ctx: StoredS3CoordinatorRuntimeHandlerContext | undefined
): Promise<Response> {
  if (options.providerId === undefined) {
    return jsonBadRequestResponse(
      "providerId must be configured for S3 event routes"
    );
  }

  const parsed = await parseJsonRequest(
    request,
    "S3 event request",
    options.maxBodyBytes
  );

  if (parsed.status === "invalid") {
    return invalidS3RequestResponse(parsed);
  }

  const recordsCountError = s3EventRecordsCountError(parsed.payload);

  if (recordsCountError !== undefined) {
    return jsonBadRequestResponse(recordsCountError);
  }

  const events = normalizeS3ObjectCreatedEvents({
    expectedBucket: options.bucket,
    payload: parsed.payload,
    providerId: options.providerId,
  });
  const body: StoredS3CoordinatorEventRouteResponse = {
    results: await routeEachEvent(events, {
      ctx,
      options,
      providerId: options.providerId,
      sessionId,
    }),
  };

  return jsonResponse(body, 202);
}

function s3EventRecordsCountError(payload: unknown): string | undefined {
  const records = isRecord(payload) ? payload.Records : undefined;

  if (Array.isArray(records) && records.length > MAX_S3_EVENT_RECORDS) {
    return "S3 event request carries too many records";
  }
}

/**
 * Route the batch one event at a time. Serial by design: each routing is a
 * coordinator mutation, and running them concurrently would race the etag.
 */
async function routeEachEvent(
  events: Awaited<ReturnType<typeof normalizeS3ObjectCreatedEvents>>,
  context: {
    ctx: StoredS3CoordinatorRuntimeHandlerContext | undefined;
    options: CreateStoredS3CoordinatorRuntimeHandlerOptions;
    /** Narrowed by the caller's guard; the option itself is optional. */
    providerId: string;
    sessionId: string;
  }
): Promise<StoredS3CoordinatorEventRouteResponseResult[]> {
  const { ctx, options, providerId, sessionId } = context;
  const results: StoredS3CoordinatorEventRouteResponseResult[] = [];

  for (const event of events) {
    const result = await routeStoredS3CoordinatorUploadEvent({
      bucket: options.bucket,
      client: options.objectClient ?? options.client,
      commitPolicy: options.commitPolicy,
      event,
      lateToleranceMs: options.lateToleranceMs,
      maxAttempts: options.maxAttempts,
      providerId,
      publicationControl: options.publicationControl,
      sessionId,
      store: options.store,
    });

    if (isSuccessfulS3MutationResult(result)) {
      notifyCursor(options.cursorNotifier, result.cursor);
      await scheduleRetiredObjectDeletes(result, options, ctx);
    }

    results.push(eventRouteResult(result));
  }

  return results;
}

export async function handleS3ReconciliationPlan(
  request: Request,
  sessionId: string,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Promise<Response> {
  const parsed = await parseS3ReconciliationPlanRequest(request, options);

  if (parsed.status === "invalid") {
    return invalidS3RequestResponse(parsed);
  }

  const result = await planStoredS3CoordinatorReconciliation({
    ...parsed.payload,
    sessionId,
    store: options.store,
  });

  if (result.status === "not_found") {
    return s3ResponseNotFound();
  }

  return jsonResponse(result, 200);
}

/** Publish each committed reconciliation and retire what it displaced. */
async function settleReconciledCommits(
  results: readonly StoredS3CoordinatorUploadReconciliationResult[],
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions,
  ctx: StoredS3CoordinatorRuntimeHandlerContext | undefined
): Promise<void> {
  for (const entry of results) {
    if (isSuccessfulS3MutationResult(entry)) {
      notifyCursor(options.cursorNotifier, entry.commit.cursor);
      await scheduleRetiredObjectDeletes(entry.commit, options, ctx);
    }
  }
}

export async function handleS3Reconciliation(
  request: Request,
  sessionId: string,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions,
  ctx: StoredS3CoordinatorRuntimeHandlerContext | undefined
): Promise<Response> {
  const parsed = await parseS3ReconciliationRequest(request, options);

  if (parsed.status === "invalid") {
    return invalidS3RequestResponse(parsed);
  }

  const result = await reconcileStoredS3CoordinatorUploads({
    ...parsed.payload,
    bucket: options.bucket,
    client: options.objectClient ?? options.client,
    commitPolicy: options.commitPolicy,
    maxAttempts: options.maxAttempts,
    publicationControl: options.publicationControl,
    sessionId,
    store: options.store,
  });

  if (result.status === "not_found") {
    return s3ResponseNotFound();
  }

  await settleReconciledCommits(result.results, options, ctx);

  const body: StoredS3CoordinatorReconciliationResponse = {
    results: result.results.map(reconciliationResult),
    summary: summarizeStoredS3CoordinatorUploadReconciliation(result),
  };

  return jsonResponse(body, 202);
}

export async function handleS3Retention(
  request: Request,
  sessionId: string,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Promise<Response> {
  const parsed = await parseS3RetentionRequest(request, options);

  if (parsed.status === "invalid") {
    return invalidS3RequestResponse(parsed);
  }

  // Persist pruned state BEFORE deleting objects so a snapshot cannot grow
  // unbounded. Trade-off: a failed delete is never re-planned; it is reported
  // for retry (idempotent) and bucket lifecycle rules are the backstop.
  const applied = await applyStoredCoordinatorRetention({
    lateToleranceMs: options.lateToleranceMs,
    maxAttempts: options.maxAttempts,
    now: parsed.payload.now,
    sessionId,
    store: options.store,
  });

  if (applied.status === "not_found") {
    return s3ResponseNotFound();
  }

  if (applied.status === "conflict") {
    return s3ResponseConflict();
  }

  return jsonResponse(await deleteRetiredObjects(applied.plan, options), 202);
}

async function deleteRetiredObjects(
  plan: StoredS3CoordinatorRetentionResponse["plan"],
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Promise<StoredS3CoordinatorRetentionResponse> {
  const result = await deleteRetiredS3CoordinatorObjects({
    bucket: options.bucket,
    client: options.retentionClient ?? options.client,
    objects: plan.retiredObjects,
  });

  return {
    plan,
    result,
    summary: summarizeRetiredCoordinatorObjectDeletions(result),
  };
}
