import type { S3Client } from "@aws-sdk/client-s3";
import type { CoordinatorRetentionPlan } from "../protocol";
import {
  type CreateStoredCoordinatorRuntimeHandlerOptions,
  createStoredCoordinatorRuntimeHandler,
  planStoredCoordinatorRetention,
  type RetiredCoordinatorObjectDeletionResult,
  type RetiredCoordinatorObjectDeletionSummary,
  summarizeRetiredCoordinatorObjectDeletions,
} from "../runtime";
import {
  type ParsedS3CommitPayload,
  type ParsedS3ReconciliationPayload,
  parseCommitTimestamp,
  parseCommitTimestampOrNow,
  parseOptionalUrlSafeIdentifierArrayField,
  parseS3CommitPayload,
  parseS3CommitPayloadRequest,
  parseS3ReconciliationPayloadRequest,
} from "../runtime/commit-payload-parser";
import {
  isSuccessfulCommitStatus,
  type SuccessfulCommitStatus,
} from "../runtime/commit-status";
import { errorMessage } from "../runtime/errors";
import { rejectionStatusCode } from "../runtime/rejection-status";
import {
  isRecord,
  optionalNonNegativeNumberField,
  optionalStringField,
  timestampField,
} from "../runtime/request-fields";
import {
  jsonBadRequestResponse,
  jsonErrorResponse,
  jsonMethodNotAllowedResponse,
  jsonResponse,
} from "../runtime/response";
import {
  DEFAULT_SESSION_PATH,
  routeIdentifierError,
  routeParts,
  S3_COMPLETION_HINT_ACTION,
  S3_ROUTE_ACTIONS,
  S3_SESSION_ROUTE_SEGMENT,
  sessionRootPath,
} from "../runtime/route";
import { parseSlotIssueRequest } from "../runtime/slot-issue-request-parser";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { OlosErrorCode } from "../types/errors";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertS3BucketName } from "./bucket";
import {
  completeStoredS3CoordinatorUpload,
  issueStoredS3CoordinatorUploadGrant,
  routeStoredS3CoordinatorUploadEvent,
} from "./coordinator";
import { normalizeS3ObjectCreatedEvents } from "./event";
import type { S3HeadObjectClient } from "./object-observation";
import { assertPositiveExpiresInSeconds } from "./options";
import {
  planStoredS3CoordinatorReconciliation,
  reconcileStoredS3CoordinatorUploads,
  type StoredS3CoordinatorUploadReconciliationResult,
  summarizeStoredS3CoordinatorUploadReconciliation,
} from "./reconciliation";
import {
  deleteRetiredS3CoordinatorObjects,
  type S3DeleteObjectClient,
} from "./retention";

interface InvalidS3HttpRequestParse {
  message: string;
  status: "invalid";
}

type S3HttpRequestParse<Payload> =
  | { payload: Payload; status: "valid" }
  | InvalidS3HttpRequestParse;

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
    return notFound();
  }

  if (result.status === "rejected") {
    return jsonResponse(
      result.error,
      rejectionStatusCode(result.error.error.code)
    );
  }

  return conflict();
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
    return notFound();
  }

  return conflict();
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
    return notFound();
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
    return notFound();
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
    return notFound();
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

type S3Route =
  | {
      action: "completion-hint";
      sessionId: string;
      slotId: string;
      status: "matched";
    }
  | {
      action:
        | "commits"
        | "events"
        | "reconcile"
        | "reconcile-plan"
        | "retention"
        | "slots";
      sessionId: string;
      status: "matched";
    }
  | InvalidS3Route
  | { status: "method_not_allowed" }
  | { status: "not_s3" };

interface InvalidS3Route {
  message: string;
  status: "invalid";
}

function s3Route(
  request: Request,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): S3Route {
  const url = new URL(request.url);
  const parts = routeParts(
    url.pathname,
    sessionRootPath(options.sessionPath ?? DEFAULT_SESSION_PATH)
  );

  if (parts === undefined) {
    return { status: "not_s3" };
  }

  if (parts === "invalid") {
    return invalidS3Route("route path contains invalid percent encoding");
  }

  const [sessionId, provider, action, completion] = parts;

  if (
    sessionId !== undefined &&
    provider === S3_ROUTE_ACTIONS.completionHint &&
    action !== undefined &&
    completion === S3_COMPLETION_HINT_ACTION &&
    parts.length === 4
  ) {
    if (request.method !== "POST") {
      return { status: "method_not_allowed" };
    }

    const sessionIdError = routeSessionIdError(sessionId);

    if (sessionIdError !== undefined) {
      return invalidS3Route(sessionIdError);
    }

    try {
      assertUrlSafeIdentifier(action, "slotId");
    } catch (error) {
      return invalidS3Route(errorMessage(error, "invalid route slotId"));
    }

    return {
      action: "completion-hint",
      sessionId,
      slotId: action,
      status: "matched",
    };
  }

  if (
    sessionId === undefined ||
    provider !== S3_SESSION_ROUTE_SEGMENT ||
    (action !== S3_ROUTE_ACTIONS.slots &&
      action !== S3_ROUTE_ACTIONS.commits &&
      action !== S3_ROUTE_ACTIONS.events &&
      action !== S3_ROUTE_ACTIONS.reconcilePlan &&
      action !== S3_ROUTE_ACTIONS.retention &&
      action !== S3_ROUTE_ACTIONS.reconcile) ||
    parts.length !== 3
  ) {
    return { status: "not_s3" };
  }

  if (request.method !== "POST") {
    return { status: "method_not_allowed" };
  }

  const sessionIdError = routeSessionIdError(sessionId);

  if (sessionIdError !== undefined) {
    return invalidS3Route(sessionIdError);
  }

  return { action, sessionId, status: "matched" };
}

function invalidS3Route(message: string): InvalidS3Route {
  return { message, status: "invalid" };
}

async function parseRecordRequest<Payload>(
  request: Request,
  name: string,
  fallbackMessage: string,
  parsePayload: (value: Record<string, unknown>) => Payload
): Promise<S3HttpRequestParse<Payload>> {
  try {
    const payload = await request.json();

    if (!isRecord(payload)) {
      return invalid(`${name} must be a JSON object`);
    }

    return {
      payload: parsePayload(payload),
      status: "valid",
    };
  } catch (error) {
    return invalid(errorMessage(error, fallbackMessage));
  }
}

async function parseJsonRequest(
  request: Request,
  name: string
): Promise<S3HttpRequestParse<unknown>> {
  try {
    return {
      payload: await request.json(),
      status: "valid",
    };
  } catch (error) {
    return invalid(errorMessage(error, `invalid ${name}`));
  }
}

type S3CommitPayload = ParsedS3CommitPayload;
type S3ReconciliationPayload = ParsedS3ReconciliationPayload;

interface S3ReconciliationPlanPayload {
  slotIds?: readonly string[];
}

interface S3RetentionPayload {
  now: string;
}

async function parseS3CompletionHintRequest(
  request: Request,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions,
  slotId: string
): Promise<S3HttpRequestParse<S3CommitPayload>> {
  return await parseRecordRequest(
    request,
    "S3 completion hint request",
    "invalid S3 completion hint request",
    (payload) => parseCompletionHintPayload(payload, options, slotId)
  );
}

async function parseS3CommitRequest(
  request: Request,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Promise<S3HttpRequestParse<S3CommitPayload>> {
  const parsed = await parseS3CommitPayloadRequest(
    request,
    invalid,
    "invalid S3 slot grant request",
    options,
    parseCommitTimestamp,
    {},
    "S3 commit request"
  );

  return parsed.status === "invalid"
    ? parsed
    : { payload: parsed.value, status: "valid" };
}

function parseCompletionHintPayload(
  value: Record<string, unknown>,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions,
  slotId: string
): S3CommitPayload {
  const defaults = createCompletionHintDefaults(options);
  const base = parseS3CommitPayload(
    value,
    options,
    (payload) =>
      parseCommitTimestampOrNow(payload, "committedAt", defaults.committedAt),
    {
      commitId: defaults.commitId(slotId),
      slotId,
    }
  );
  assertNoCompletionHintDeliveryUrl(value);
  optionalStringField(value, "etag");
  optionalNonNegativeNumberField(value, "size");

  return base;
}

function assertNoCompletionHintDeliveryUrl(
  value: Record<string, unknown>
): void {
  if (value.deliveryUrl !== undefined) {
    throw new Error("completion hint must not include deliveryUrl");
  }
}

async function parseS3ReconciliationPlanRequest(
  request: Request
): Promise<S3HttpRequestParse<S3ReconciliationPlanPayload>> {
  return await parseRecordRequest(
    request,
    "S3 reconciliation plan request",
    "invalid S3 reconciliation plan request",
    (payload) => ({
      ...parseOptionalUrlSafeIdentifierArrayField(payload, "slotIds"),
    })
  );
}

async function parseS3ReconciliationRequest(
  request: Request,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Promise<S3HttpRequestParse<S3ReconciliationPayload>> {
  const parsed = await parseS3ReconciliationPayloadRequest(
    request,
    invalid,
    "invalid S3 reconciliation request",
    options,
    parseCommitTimestamp,
    "S3 reconciliation request"
  );

  return parsed.status === "invalid"
    ? parsed
    : { payload: parsed.value, status: "valid" };
}

async function parseS3RetentionRequest(
  request: Request
): Promise<S3HttpRequestParse<S3RetentionPayload>> {
  return await parseRecordRequest(
    request,
    "S3 retention request",
    "invalid S3 retention request",
    (payload) => ({
      now: timestampField(payload, "now"),
    })
  );
}

function invalid(message: string): InvalidS3HttpRequestParse {
  return { message, status: "invalid" };
}

function routeSessionIdError(sessionId: string): string | undefined {
  return routeIdentifierError(
    sessionId,
    "sessionId",
    "invalid route sessionId"
  );
}

function notFound(): Response {
  return jsonErrorResponse("coordinator session was not found", 404);
}

function conflict(): Response {
  return jsonErrorResponse("coordinator session changed during mutation", 409);
}

function isSuccessfulS3MutationResult<Result extends { status: string }>(
  result: Result
): result is Extract<Result, { status: SuccessfulCommitStatus }> {
  return isSuccessfulCommitStatus(result.status);
}

function eventRouteResult(
  result: Awaited<ReturnType<typeof routeStoredS3CoordinatorUploadEvent>>
): StoredS3CoordinatorEventRouteResponseResult {
  if (isSuccessfulS3MutationResult(result)) {
    return {
      commit: result.commit,
      status: result.status,
    };
  }

  if (result.status === "invalid_event") {
    return {
      error: result.error.error,
      status: result.status,
    };
  }

  if (result.status === "rejected") {
    return {
      ...rejectionBody(result),
      error: result.error.error,
      status: result.status,
    };
  }

  return { status: result.status };
}

function rejectionBody(
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

function reconciliationResult(
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

function optionalCursorResponse(
  cursor: Cursor | undefined
): Pick<StoredS3CoordinatorCommitResponse, "cursor"> | Record<string, never> {
  return cursor === undefined ? {} : { cursor };
}

const DEFAULT_COMPLETION_HINT_COMMIT_ID_PREFIX = "complete_";
const DEFAULT_COMPLETION_HINT_NOW = (): Date | string => new Date();

interface CompletionHintDefaults {
  commitId: (slotId: string) => string;
  committedAt: () => string;
}

function createCompletionHintDefaults(
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): CompletionHintDefaults {
  return {
    committedAt: () =>
      completionHintTimestamp(resolveCompletionHintNow(options)),
    commitId: resolveCompletionHintCommitId(options),
  };
}

function resolveCompletionHintCommitId(
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): (slotId: string) => string {
  if (options.completionHintCommitId !== undefined) {
    return options.completionHintCommitId;
  }

  return completionHintCommitId;
}

function resolveCompletionHintNow(
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): () => Date | string {
  if (options.completionHintClock !== undefined) {
    return options.completionHintClock;
  }

  if (options.completionHintNow !== undefined) {
    return options.completionHintNow;
  }

  return DEFAULT_COMPLETION_HINT_NOW;
}

function completionHintCommitId(slotId: string): string {
  return `${DEFAULT_COMPLETION_HINT_COMMIT_ID_PREFIX}${slotId}`;
}

function completionHintTimestamp(
  now: (() => Date | string) | undefined
): string {
  if (now === undefined) {
    return new Date().toISOString();
  }

  const next = now();

  return next instanceof Date ? next.toISOString() : next;
}
