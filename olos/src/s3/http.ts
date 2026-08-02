import { createStoredCoordinatorRuntimeHandler } from "../runtime/http";
import { rejectionStatusCode } from "../runtime/rejection-status";
import {
  jsonBadRequestResponse,
  jsonMethodNotAllowedResponse,
  jsonResponse,
} from "../runtime/response";
import {
  applyStoredCoordinatorRetention,
  summarizeRetiredCoordinatorObjectDeletions,
} from "../runtime/retention";
import { parseSlotIssueRequest } from "../runtime/slot-issue-request-parser";
import type { Cursor } from "../types/cursor";
import { positiveNumber } from "../validation/fields";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertS3BucketName } from "./bucket";
import {
  completeStoredS3CoordinatorUpload,
  issueStoredS3CoordinatorUploadGrant,
  routeStoredS3CoordinatorUploadEvent,
} from "./coordinator";
import { normalizeS3ObjectCreatedEvents } from "./event";
import {
  parseJsonRequest,
  parseS3CommitRequest,
  parseS3CompletionHintRequest,
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
import { s3Route } from "./http-route";
import type {
  CreateStoredS3CoordinatorRuntimeHandlerOptions,
  StoredS3CoordinatorCommitResponse,
  StoredS3CoordinatorEventRouteResponse,
  StoredS3CoordinatorEventRouteResponseResult,
  StoredS3CoordinatorReconciliationResponse,
  StoredS3CoordinatorRetentionResponse,
  StoredS3CoordinatorSlotGrantResponse,
} from "./http-types";
import {
  planStoredS3CoordinatorReconciliation,
  reconcileStoredS3CoordinatorUploads,
  summarizeStoredS3CoordinatorUploadReconciliation,
} from "./reconciliation";
import { deleteRetiredS3CoordinatorObjects } from "./retention";
import { S3_ROUTE_ACTIONS } from "./route";

export type {
  StoredS3CoordinatorCommitResponse,
  StoredS3CoordinatorEventRouteResponse,
  StoredS3CoordinatorEventRouteResponseResult,
  StoredS3CoordinatorReconciliationResponse,
  StoredS3CoordinatorReconciliationResponseResult,
  StoredS3CoordinatorRetentionResponse,
  StoredS3CoordinatorRouteError,
  StoredS3CoordinatorSlotGrantResponse,
} from "./http-types";

/**
 * Subset of Cloudflare's ExecutionContext. When provided, the handler routes
 * retention-side S3 deletes through waitUntil so SigV4 signing CPU is paid
 * outside the request's CPU budget — essential on Workers Free's ~10 ms cap.
 */
export interface StoredS3CoordinatorRuntimeHandlerContext {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Fetch-style handler returned by
 * {@link createStoredS3CoordinatorRuntimeHandler}. Without a `ctx`, deferred
 * S3 deletes are awaited inline before the response is returned.
 */
export type StoredS3CoordinatorRuntimeHandler = (
  request: Request,
  ctx?: StoredS3CoordinatorRuntimeHandlerContext
) => Promise<Response>;

interface InvalidS3HttpRequestParse {
  message: string;
  status: "invalid";
}

function invalid(message: string): InvalidS3HttpRequestParse {
  return { message, status: "invalid" };
}

/**
 * Create an HTTP handler that serves the S3 coordinator routes for a stored
 * session — slot grants (`s3/slots`, 201), commits and completion hints
 * (201, or 200 when idempotent), provider event ingestion (`s3/events`,
 * 202 with per-record results), reconciliation plan/apply (200/202), and
 * retention sweeps (202). Non-S3 paths fall through to the base coordinator
 * runtime handler. Error responses are JSON bodies whose `error.code` is an
 * `olos.*` code: 400 for malformed requests, 404 for unknown sessions
 * (`olos.invalid_session`), 409 for concurrency conflicts, and rejections
 * mapped from their error code. Successful commits delete retired S3
 * objects as a side effect (via `ctx.waitUntil` when available), and
 * retention persists the pruned state before deleting objects. A failed
 * delete is NOT re-planned by later sweeps — the pruned state no longer
 * references it. Failures surface in the 202 response body
 * (`result.failedObjects` and the `summary`) for caller-driven retry;
 * configure a bucket lifecycle rule as the backstop for orphans. Throws
 * synchronously when `bucket`, `expiresInSeconds`, or `providerId` options
 * are invalid.
 */
export function createStoredS3CoordinatorRuntimeHandler(
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): StoredS3CoordinatorRuntimeHandler {
  assertS3HandlerOptions(options);

  const baseHandler = createStoredCoordinatorRuntimeHandler(options);

  return async (request, ctx) => {
    const route = s3Route(request, options);

    if (route.status === "not_s3") {
      return await baseHandler(request);
    }

    if (route.status === "method_not_allowed") {
      return jsonMethodNotAllowedResponse(["POST"]);
    }

    if (route.status === "invalid") {
      return jsonBadRequestResponse(route.message);
    }

    if (route.action === S3_ROUTE_ACTIONS.slots) {
      return await handleS3SlotGrant(request, route.sessionId, options);
    }

    if (route.action === S3_ROUTE_ACTIONS.commits) {
      return await handleS3Commit(request, route.sessionId, options, ctx);
    }

    if (route.action === "completion-hint") {
      return await handleS3CompletionHint(
        request,
        route.sessionId,
        route.slotId,
        options,
        ctx
      );
    }

    if (route.action === S3_ROUTE_ACTIONS.events) {
      return await handleS3Events(request, route.sessionId, options, ctx);
    }

    if (route.action === S3_ROUTE_ACTIONS.reconcilePlan) {
      return await handleS3ReconciliationPlan(
        request,
        route.sessionId,
        options
      );
    }

    if (route.action === S3_ROUTE_ACTIONS.retention) {
      return await handleS3Retention(request, route.sessionId, options);
    }

    return await handleS3Reconciliation(request, route.sessionId, options, ctx);
  };
}

function assertS3HandlerOptions(
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): void {
  assertS3BucketName(options.bucket);
  positiveNumber(options.expiresInSeconds, "expiresInSeconds");

  if (options.providerId !== undefined) {
    assertUrlSafeIdentifier(options.providerId, "providerId");
  }
}

async function handleS3SlotGrant(
  request: Request,
  sessionId: string,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Promise<Response> {
  const parsed = await parseSlotIssueRequest(
    request,
    invalid,
    "invalid S3 slot grant request",
    "S3 slot grant request"
  );

  if (parsed.status === "invalid") {
    return jsonBadRequestResponse(parsed.message);
  }

  const result = await issueStoredS3CoordinatorUploadGrant({
    ...parsed.value,
    additionalHeaders: options.additionalHeaders,
    bucket: options.bucket,
    client: options.client,
    expiresInSeconds: options.expiresInSeconds,
    maxAttempts: options.maxAttempts,
    now: options.grantNow?.(),
    publicationControl: options.publicationControl,
    sessionId,
    store: options.store,
  });

  if (result.status === "saved") {
    const body: StoredS3CoordinatorSlotGrantResponse = {
      grant: result.grant,
      slot: result.slot,
    };

    return jsonResponse(body, 201);
  }

  if (result.status === "not_found") {
    return s3ResponseNotFound();
  }

  if (result.status === "rejected") {
    return jsonResponse(
      result.error,
      rejectionStatusCode(result.error.error.code)
    );
  }

  return s3ResponseConflict();
}

async function handleS3Commit(
  request: Request,
  sessionId: string,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions,
  ctx: StoredS3CoordinatorRuntimeHandlerContext | undefined
): Promise<Response> {
  const parsed = await parseS3CommitRequest(request, options);

  if (parsed.status === "invalid") {
    return jsonBadRequestResponse(parsed.message);
  }

  const result = await completeStoredS3CoordinatorUpload({
    ...parsed.payload,
    bucket: options.bucket,
    client: options.objectClient ?? options.client,
    commitPolicy: options.commitPolicy,
    maxAttempts: options.maxAttempts,
    publicationControl: options.publicationControl,
    sessionId,
    store: options.store,
  });

  await scheduleRetiredObjectDeletes(result, options, ctx);
  return s3CommitResponse(result, options);
}

async function handleS3CompletionHint(
  request: Request,
  sessionId: string,
  slotId: string,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions,
  ctx: StoredS3CoordinatorRuntimeHandlerContext | undefined
): Promise<Response> {
  const parsed = await parseS3CompletionHintRequest(request, options, slotId);

  if (parsed.status === "invalid") {
    return jsonBadRequestResponse(parsed.message);
  }

  const result = await completeStoredS3CoordinatorUpload({
    ...parsed.payload,
    bucket: options.bucket,
    client: options.objectClient ?? options.client,
    commitPolicy: options.commitPolicy,
    maxAttempts: options.maxAttempts,
    publicationControl: options.publicationControl,
    sessionId,
    store: options.store,
  });

  await scheduleRetiredObjectDeletes(result, options, ctx);
  return s3CommitResponse(result, options);
}

// Drop the storage-side objects for commits the state machine pruned. When
// a waitUntil-capable context is supplied (Cloudflare Workers), the deletes
// run after the response goes out so SigV4 signing CPU stays outside the
// request budget — required on Workers Free's ~10 ms cap. Without a ctx,
// the deletes await inline (correct, just costs request CPU; that's the
// path tests and non-CF runtimes take).
async function scheduleRetiredObjectDeletes(
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

function s3CommitResponse(
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

async function handleS3Events(
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

  const parsed = await parseJsonRequest(request, "S3 event request");

  if (parsed.status === "invalid") {
    return jsonBadRequestResponse(parsed.message);
  }

  const events = normalizeS3ObjectCreatedEvents({
    expectedBucket: options.bucket,
    payload: parsed.payload,
    providerId: options.providerId,
  });
  const results: StoredS3CoordinatorEventRouteResponseResult[] = [];

  for (const event of events) {
    const result = await routeStoredS3CoordinatorUploadEvent({
      bucket: options.bucket,
      client: options.objectClient ?? options.client,
      commitPolicy: options.commitPolicy,
      event,
      lateToleranceMs: options.lateToleranceMs,
      maxAttempts: options.maxAttempts,
      providerId: options.providerId,
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

  const body: StoredS3CoordinatorEventRouteResponse = { results };

  return jsonResponse(body, 202);
}

async function handleS3ReconciliationPlan(
  request: Request,
  sessionId: string,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Promise<Response> {
  const parsed = await parseS3ReconciliationPlanRequest(request);

  if (parsed.status === "invalid") {
    return jsonBadRequestResponse(parsed.message);
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

async function handleS3Reconciliation(
  request: Request,
  sessionId: string,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions,
  ctx: StoredS3CoordinatorRuntimeHandlerContext | undefined
): Promise<Response> {
  const parsed = await parseS3ReconciliationRequest(request, options);

  if (parsed.status === "invalid") {
    return jsonBadRequestResponse(parsed.message);
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

  for (const entry of result.results) {
    if (isSuccessfulS3MutationResult(entry)) {
      notifyCursor(options.cursorNotifier, entry.commit.cursor);
      await scheduleRetiredObjectDeletes(entry.commit, options, ctx);
    }
  }

  const body: StoredS3CoordinatorReconciliationResponse = {
    results: result.results.map(reconciliationResult),
    summary: summarizeStoredS3CoordinatorUploadReconciliation(result),
  };

  return jsonResponse(body, 202);
}

async function handleS3Retention(
  request: Request,
  sessionId: string,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Promise<Response> {
  const parsed = await parseS3RetentionRequest(request);

  if (parsed.status === "invalid") {
    return jsonBadRequestResponse(parsed.message);
  }

  // Persist the pruned coordinator state BEFORE deleting remote objects so
  // an unpruned snapshot cannot keep growing. The trade-off: a failed
  // delete is never re-planned (the pruned state no longer references the
  // object). Failures are reported in the response body for the caller to
  // retry (deletes are idempotent); bucket lifecycle rules are the backstop
  // for orphaned objects.
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

  const result = await deleteRetiredS3CoordinatorObjects({
    bucket: options.bucket,
    client: options.retentionClient ?? options.client,
    objects: applied.plan.retiredObjects,
  });

  const body: StoredS3CoordinatorRetentionResponse = {
    plan: applied.plan,
    result,
    summary: summarizeRetiredCoordinatorObjectDeletions(result),
  };

  return jsonResponse(body, 202);
}
