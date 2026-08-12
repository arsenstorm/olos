import { rejectionStatusCode } from "../runtime/rejection-status";
import { jsonBadRequestResponse, jsonResponse } from "../runtime/response";
import {
  applyStoredCoordinatorRetention,
  summarizeRetiredCoordinatorObjectDeletions,
} from "../runtime/retention";
import { parseSlotIssueRequest } from "../runtime/slot-issue-request-parser";
import type { Cursor } from "../types/cursor";
import { createOlosError } from "../types/errors";
import { errorMessage } from "../validation/fields";
import {
  completeStoredS3CoordinatorUpload,
  routeStoredS3CoordinatorUploadEvent,
} from "./coordinator-event";
import { issueStoredS3CoordinatorUploadGrant } from "./coordinator-grant";
import { normalizeS3ObjectCreatedEvents } from "./event";
import { invalid, type StoredS3CoordinatorRuntimeHandlerContext } from "./http";
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
import type {
  CreateStoredS3CoordinatorRuntimeHandlerOptions,
  StoredS3CoordinatorCommitResponse,
  StoredS3CoordinatorEventRouteResponse,
  StoredS3CoordinatorEventRouteResponseResult,
  StoredS3CoordinatorReconciliationResponse,
  StoredS3CoordinatorRetentionResponse,
  StoredS3CoordinatorSlotGrantResponse,
} from "./http-types";
import type { S3HeadObjectClient } from "./object-observation";
import {
  reconcileStoredS3CoordinatorUploads,
  summarizeStoredS3CoordinatorUploadReconciliation,
} from "./reconciliation";
import { planStoredS3CoordinatorReconciliation } from "./reconciliation-summary";
import { deleteRetiredS3CoordinatorObjects } from "./retention";

export async function handleS3SlotGrant(
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

export async function handleS3Commit(
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

export async function handleS3CompletionHint(
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

  let result: Awaited<ReturnType<typeof completeStoredS3CoordinatorUpload>>;

  try {
    result = await completeStoredS3CoordinatorUpload({
      ...parsed.payload,
      bucket: options.bucket,
      client: tagCompletionHintObservationFailures(
        options.objectClient ?? options.client
      ),
      commitPolicy: options.commitPolicy,
      maxAttempts: options.maxAttempts,
      publicationControl: options.publicationControl,
      sessionId,
      store: options.store,
    });
  } catch (error) {
    if (error instanceof S3CompletionHintObservationError) {
      return completionHintNotObservedResponse(error);
    }

    throw error;
  }

  await scheduleRetiredObjectDeletes(result, options, ctx);
  return s3CommitResponse(result, options);
}

/**
 * Marks `HeadObject` failures raised while verifying a completion hint.
 * Only these map to the hint's "not yet observed" error envelope; any other
 * throw (store I/O, a corrupt snapshot) still reaches the handler's opaque
 * 500 guard.
 */
class S3CompletionHintObservationError extends Error {
  constructor(cause: unknown) {
    super(errorMessage(cause, "completion hint object was not observed"));
    this.name = "S3CompletionHintObservationError";
  }
}

// Spec §7.9: a completion hint is not proof — the uploaded object may not
// be visible to `HeadObject` yet, so a failed observation on the hint path
// is an expected outcome, not an internal error. Tag observation failures
// at the client boundary so the route can tell them apart from store I/O.
function tagCompletionHintObservationFailures(
  client: S3HeadObjectClient
): S3HeadObjectClient {
  return {
    async send(command) {
      try {
        return await client.send(command);
      } catch (error) {
        throw new S3CompletionHintObservationError(error);
      }
    },
  };
}

// The slot stays uncommitted awaiting object proof; report the failed
// observation in the reconciliation routes' failed-record style
// (`olos.invalid_state` with the observation failure's message) so the
// publisher can retry the hint or leave it to events/reconciliation.
function completionHintNotObservedResponse(
  error: S3CompletionHintObservationError
): Response {
  return jsonResponse(
    createOlosError("olos.invalid_state", error.message),
    rejectionStatusCode("olos.invalid_state")
  );
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

export async function handleS3ReconciliationPlan(
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

export async function handleS3Reconciliation(
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

export async function handleS3Retention(
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
