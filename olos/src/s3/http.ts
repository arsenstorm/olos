import type { S3Client } from "@aws-sdk/client-s3";
import {
  type CreateStoredCoordinatorRuntimeHandlerOptions,
  createStoredCoordinatorRuntimeHandler,
  planStoredCoordinatorRetention,
  summarizeRetiredCoordinatorObjectDeletions,
} from "../runtime";
import { rejectionStatusCode } from "../runtime/rejection-status";
import {
  jsonBadRequestResponse,
  jsonMethodNotAllowedResponse,
  jsonResponse,
} from "../runtime/response";
import { S3_ROUTE_ACTIONS } from "../runtime/route";
import { parseSlotIssueRequest } from "../runtime/slot-issue-request-parser";
import type { Cursor } from "../types/cursor";
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
  StoredS3CoordinatorCommitResponse,
  StoredS3CoordinatorEventRouteResponse,
  StoredS3CoordinatorEventRouteResponseResult,
  StoredS3CoordinatorReconciliationResponse,
  StoredS3CoordinatorRetentionResponse,
  StoredS3CoordinatorSlotGrantResponse,
} from "./http-types";
import type { S3HeadObjectClient } from "./object-observation";
import { assertPositiveExpiresInSeconds } from "./options";
import {
  planStoredS3CoordinatorReconciliation,
  reconcileStoredS3CoordinatorUploads,
  summarizeStoredS3CoordinatorUploadReconciliation,
} from "./reconciliation";
import {
  deleteRetiredS3CoordinatorObjects,
  type S3DeleteObjectClient,
} from "./retention";

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

export interface CreateStoredS3CoordinatorRuntimeHandlerOptions
  extends CreateStoredCoordinatorRuntimeHandlerOptions {
  additionalHeaders?: Record<string, string>;
  bucket: string;
  client: S3Client;
  completionHintClock?: () => Date | string;
  completionHintCommitId?: (slotId: string) => string;
  completionHintNow?: () => Date | string;
  expiresInSeconds: number;
  grantNow?: () => Date | string;
  lateToleranceMs?: number;
  objectClient?: S3HeadObjectClient;
  providerId?: string;
  retentionClient?: S3DeleteObjectClient;
}

export type StoredS3CoordinatorRuntimeHandler = (
  request: Request
) => Promise<Response>;

interface InvalidS3HttpRequestParse {
  message: string;
  status: "invalid";
}

function invalid(message: string): InvalidS3HttpRequestParse {
  return { message, status: "invalid" };
}

export function createStoredS3CoordinatorRuntimeHandler(
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): StoredS3CoordinatorRuntimeHandler {
  assertS3HandlerOptions(options);

  const baseHandler = createStoredCoordinatorRuntimeHandler(options);

  return async (request) => {
    const route = s3Route(request, options);

    if (route.status === "not_s3") {
      return await baseHandler(request);
    }

    if (route.status === "method_not_allowed") {
      return jsonMethodNotAllowedResponse();
    }

    if (route.status === "invalid") {
      return jsonBadRequestResponse(route.message);
    }

    if (route.action === S3_ROUTE_ACTIONS.slots) {
      return await handleS3SlotGrant(request, route.sessionId, options);
    }

    if (route.action === S3_ROUTE_ACTIONS.commits) {
      return await handleS3Commit(request, route.sessionId, options);
    }

    if (route.action === "completion-hint") {
      return await handleS3CompletionHint(
        request,
        route.sessionId,
        route.slotId,
        options
      );
    }

    if (route.action === S3_ROUTE_ACTIONS.events) {
      return await handleS3Events(request, route.sessionId, options);
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

    return await handleS3Reconciliation(request, route.sessionId, options);
  };
}

function assertS3HandlerOptions(
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): void {
  assertS3BucketName(options.bucket);
  assertPositiveExpiresInSeconds(options.expiresInSeconds);

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
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
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

  return s3CommitResponse(result, options);
}

async function handleS3CompletionHint(
  request: Request,
  sessionId: string,
  slotId: string,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
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

  return s3CommitResponse(result, options);
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
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
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
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
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

  const planned = await planStoredCoordinatorRetention({
    now: parsed.payload.now,
    sessionId,
    store: options.store,
  });

  if (planned.status === "not_found") {
    return s3ResponseNotFound();
  }

  const result = await deleteRetiredS3CoordinatorObjects({
    bucket: options.bucket,
    client: options.retentionClient ?? options.client,
    objects: planned.plan.retiredObjects,
  });

  const body: StoredS3CoordinatorRetentionResponse = {
    plan: planned.plan,
    result,
    summary: summarizeRetiredCoordinatorObjectDeletions(result),
  };

  return jsonResponse(body, 202);
}
