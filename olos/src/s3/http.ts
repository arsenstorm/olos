import type { S3Client } from "@aws-sdk/client-s3";
import { MEDIA_OBJECT_KINDS } from "../config/media-object";
import { PUBLICATION_MODES } from "../config/publication";
import type { CoordinatorRetentionPlan } from "../protocol";
import {
  type CreateStoredCoordinatorRuntimeHandlerOptions,
  createStoredCoordinatorRuntimeHandler,
  planStoredCoordinatorRetention,
  type RetiredCoordinatorObjectDeletionResult,
  type RetiredCoordinatorObjectDeletionSummary,
  type RuntimeSlotIssuePayload,
  summarizeRetiredCoordinatorObjectDeletions,
} from "../runtime";
import { errorMessage } from "../runtime/errors";
import { rejectionStatusCode } from "../runtime/rejection-status";
import {
  booleanField,
  isRecord,
  nonNegativeIntegerField,
  nonNegativeNumberField,
  positiveIntegerField,
  positiveNumberField,
  stringField,
  timestampField,
  urlSafeIdentifierField,
} from "../runtime/request-fields";
import { jsonResponse } from "../runtime/response";
import { routeParts } from "../runtime/route";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { OlosErrorCode } from "../types/errors";
import type { MediaObjectKind } from "../types/media-object";
import type { UploadGrant } from "../types/upload-grant";
import type { PublicationMode, UploadSlot } from "../types/upload-slot";
import { assertSafeDeliveryUrl } from "../validation/delivery-url";
import { assertUrlSafeIdentifier } from "../validation/ids";
import {
  assertSafeMediaObjectKey,
  assertSafeObjectKey,
} from "../validation/object-key";
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

const DEFAULT_SESSION_PATH = "/sessions";

export interface CreateStoredS3CoordinatorRuntimeHandlerOptions
  extends CreateStoredCoordinatorRuntimeHandlerOptions {
  additionalHeaders?: Record<string, string>;
  bucket: string;
  client: S3Client;
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
      return methodNotAllowed();
    }

    if (route.status === "invalid") {
      return badRequest(route.message);
    }

    if (route.action === "slots") {
      return await handleS3SlotGrant(request, route.sessionId, options);
    }

    if (route.action === "commits") {
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

    if (route.action === "events") {
      return await handleS3Events(request, route.sessionId, options);
    }

    if (route.action === "reconcile-plan") {
      return await handleS3ReconciliationPlan(
        request,
        route.sessionId,
        options
      );
    }

    if (route.action === "retention") {
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
  const parsed = await parseS3SlotGrantRequest(request);

  if (parsed.status === "invalid") {
    return badRequest(parsed.message);
  }

  const result = await issueStoredS3CoordinatorUploadGrant({
    ...parsed.payload,
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
    return badRequest(parsed.message);
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
    return badRequest(parsed.message);
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
  if (result.status === "committed" || result.status === "idempotent") {
    notifyCursor(options.cursorNotifier, result.cursor);

    const body: StoredS3CoordinatorCommitResponse = {
      commit: result.commit,
      ...(result.cursor === undefined ? {} : { cursor: result.cursor }),
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
    return badRequest("providerId must be configured for S3 event routes");
  }

  const parsed = await parseJsonRequest(request, "S3 event request");

  if (parsed.status === "invalid") {
    return badRequest(parsed.message);
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

    if (result.status === "committed" || result.status === "idempotent") {
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
    return badRequest(parsed.message);
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
    return badRequest(parsed.message);
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
    if (entry.status === "committed" || entry.status === "idempotent") {
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
    return badRequest(parsed.message);
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
  | { message: string; status: "invalid" }
  | { status: "method_not_allowed" }
  | { status: "not_s3" };

function s3Route(
  request: Request,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): S3Route {
  const url = new URL(request.url);
  const parts = routeParts(
    url.pathname,
    options.sessionPath ?? DEFAULT_SESSION_PATH
  );

  if (parts === undefined) {
    return { status: "not_s3" };
  }

  if (parts === "invalid") {
    return {
      message: "route path contains invalid percent encoding",
      status: "invalid",
    };
  }

  const [sessionId, provider, action] = parts;

  if (
    sessionId !== undefined &&
    provider === "upload-slots" &&
    action !== undefined &&
    parts[3] === "complete" &&
    parts.length === 4
  ) {
    if (request.method !== "POST") {
      return { status: "method_not_allowed" };
    }

    const sessionIdError = routeSessionIdError(sessionId);

    if (sessionIdError !== undefined) {
      return { message: sessionIdError, status: "invalid" };
    }

    try {
      assertUrlSafeIdentifier(action, "slotId");
    } catch (error) {
      return {
        message: errorMessage(error, "invalid route slotId"),
        status: "invalid",
      };
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
    provider !== "s3" ||
    (action !== "slots" &&
      action !== "commits" &&
      action !== "events" &&
      action !== "reconcile-plan" &&
      action !== "retention" &&
      action !== "reconcile") ||
    parts.length !== 3
  ) {
    return { status: "not_s3" };
  }

  if (request.method !== "POST") {
    return { status: "method_not_allowed" };
  }

  const sessionIdError = routeSessionIdError(sessionId);

  if (sessionIdError !== undefined) {
    return { message: sessionIdError, status: "invalid" };
  }

  return { action, sessionId, status: "matched" };
}

async function parseS3SlotGrantRequest(
  request: Request
): Promise<
  | { payload: RuntimeSlotIssuePayload; status: "valid" }
  | { message: string; status: "invalid" }
> {
  try {
    const payload = await request.json();

    if (!isRecord(payload)) {
      return invalid("S3 slot grant request must be a JSON object");
    }

    return {
      payload: parsePayload(payload),
      status: "valid",
    };
  } catch (error) {
    return invalid(errorMessage(error, "invalid S3 slot grant request"));
  }
}

async function parseJsonRequest(
  request: Request,
  name: string
): Promise<
  { payload: unknown; status: "valid" } | { message: string; status: "invalid" }
> {
  try {
    return {
      payload: await request.json(),
      status: "valid",
    };
  } catch (error) {
    return invalid(errorMessage(error, `invalid ${name}`));
  }
}

function parsePayload(value: Record<string, unknown>): RuntimeSlotIssuePayload {
  const kind = mediaObjectKindField(value);
  const deliveryUrl = stringField(value, "deliveryUrl");
  const objectKey = stringField(value, "objectKey");

  assertSafeDeliveryUrl(deliveryUrl, "deliveryUrl");
  assertSafeMediaObjectKey(objectKey, kind, "objectKey");

  return {
    contentType: stringField(value, "contentType"),
    deliveryUrl,
    duration: positiveNumberField(value, "duration"),
    expiresAt: stringField(value, "expiresAt"),
    kind,
    maxBytes: positiveNumberField(value, "maxBytes"),
    mediaSequenceNumber: nonNegativeIntegerField(value, "mediaSequenceNumber"),
    objectKey,
    publicationMode: publicationModeField(value),
    publisherInstanceId: urlSafeIdentifierField(value, "publisherInstanceId"),
    renditionId: urlSafeIdentifierField(value, "renditionId"),
    slotId: urlSafeIdentifierField(value, "slotId"),
    ...optionalNonNegativeIntegerField(value, "minBytes"),
    ...optionalNonNegativeIntegerField(value, "partNumber"),
  };
}

interface S3CommitPayload {
  commitId: string;
  committedAt: string;
  independent?: boolean;
  lateToleranceMs?: number;
  maxSegments?: number;
  objectKey?: string;
  programDateTime?: string;
  providerId: string;
  slotId: string;
  versionId?: string;
}

interface S3ReconciliationPayload {
  committedAt: string;
  independent?: boolean;
  lateToleranceMs?: number;
  maxSegments?: number;
  programDateTime?: string;
  providerId: string;
  slotIds?: readonly string[];
  versionId?: string;
}

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
): Promise<
  | { payload: S3CommitPayload; status: "valid" }
  | { message: string; status: "invalid" }
> {
  try {
    const payload = await request.json();

    if (!isRecord(payload)) {
      return invalid("S3 completion hint request must be a JSON object");
    }

    return {
      payload: parseCompletionHintPayload(payload, options, slotId),
      status: "valid",
    };
  } catch (error) {
    return invalid(errorMessage(error, "invalid S3 completion hint request"));
  }
}

async function parseS3CommitRequest(
  request: Request,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Promise<
  | { payload: S3CommitPayload; status: "valid" }
  | { message: string; status: "invalid" }
> {
  try {
    const payload = await request.json();

    if (!isRecord(payload)) {
      return invalid("S3 commit request must be a JSON object");
    }

    return {
      payload: parseCommitPayload(payload, options),
      status: "valid",
    };
  } catch (error) {
    return invalid(errorMessage(error, "invalid S3 slot grant request"));
  }
}

function parseCompletionHintPayload(
  value: Record<string, unknown>,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions,
  slotId: string
): S3CommitPayload {
  const providerId = providerIdField(value, options);
  assertNoCompletionHintDeliveryUrl(value);
  const objectKey = optionalObjectKeyField(value);
  optionalStringField(value, "etag");
  optionalNonNegativeNumberField(value, "size");

  return {
    commitId:
      optionalUrlSafeIdentifierField(value, "commitId") ?? `complete_${slotId}`,
    committedAt:
      optionalTimestampValueField(value, "committedAt") ??
      new Date().toISOString(),
    providerId,
    slotId,
    ...optionalBooleanField(value, "independent"),
    ...optionalNonNegativeNumberField(value, "lateToleranceMs"),
    ...optionalPositiveIntegerField(value, "maxSegments"),
    ...objectKey,
    ...optionalTimestampField(value, "programDateTime"),
    ...optionalStringField(value, "versionId"),
  };
}

function assertNoCompletionHintDeliveryUrl(
  value: Record<string, unknown>
): void {
  if (value.deliveryUrl !== undefined) {
    throw new Error("completion hint must not include deliveryUrl");
  }
}

function parseCommitPayload(
  value: Record<string, unknown>,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): S3CommitPayload {
  const providerId = providerIdField(value, options);
  const objectKey = optionalObjectKeyField(value);

  return {
    commitId: urlSafeIdentifierField(value, "commitId"),
    committedAt: timestampField(value, "committedAt"),
    providerId,
    slotId: urlSafeIdentifierField(value, "slotId"),
    ...optionalBooleanField(value, "independent"),
    ...optionalNonNegativeNumberField(value, "lateToleranceMs"),
    ...optionalPositiveIntegerField(value, "maxSegments"),
    ...objectKey,
    ...optionalTimestampField(value, "programDateTime"),
    ...optionalStringField(value, "versionId"),
  };
}

async function parseS3ReconciliationPlanRequest(
  request: Request
): Promise<
  | { payload: S3ReconciliationPlanPayload; status: "valid" }
  | { message: string; status: "invalid" }
> {
  try {
    const payload = await request.json();

    if (!isRecord(payload)) {
      return invalid("S3 reconciliation plan request must be a JSON object");
    }

    return {
      payload: {
        ...optionalUrlSafeIdentifierArrayField(payload, "slotIds"),
      },
      status: "valid",
    };
  } catch (error) {
    return invalid(
      errorMessage(error, "invalid S3 reconciliation plan request")
    );
  }
}

async function parseS3ReconciliationRequest(
  request: Request,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Promise<
  | { payload: S3ReconciliationPayload; status: "valid" }
  | { message: string; status: "invalid" }
> {
  try {
    const payload = await request.json();

    if (!isRecord(payload)) {
      return invalid("S3 reconciliation request must be a JSON object");
    }

    return {
      payload: parseReconciliationPayload(payload, options),
      status: "valid",
    };
  } catch (error) {
    return invalid(errorMessage(error, "invalid S3 reconciliation request"));
  }
}

async function parseS3RetentionRequest(
  request: Request
): Promise<
  | { payload: S3RetentionPayload; status: "valid" }
  | { message: string; status: "invalid" }
> {
  try {
    const payload = await request.json();

    if (!isRecord(payload)) {
      return invalid("S3 retention request must be a JSON object");
    }

    return {
      payload: {
        now: timestampField(payload, "now"),
      },
      status: "valid",
    };
  } catch (error) {
    return invalid(errorMessage(error, "invalid S3 retention request"));
  }
}

function parseReconciliationPayload(
  value: Record<string, unknown>,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): S3ReconciliationPayload {
  const providerId = providerIdField(value, options);

  return {
    committedAt: timestampField(value, "committedAt"),
    providerId,
    ...optionalBooleanField(value, "independent"),
    ...optionalNonNegativeNumberField(value, "lateToleranceMs"),
    ...optionalPositiveIntegerField(value, "maxSegments"),
    ...optionalTimestampField(value, "programDateTime"),
    ...optionalStringField(value, "versionId"),
    ...optionalUrlSafeIdentifierArrayField(value, "slotIds"),
  };
}

function invalid(message: string): { message: string; status: "invalid" } {
  return { message, status: "invalid" };
}

function routeSessionIdError(sessionId: string): string | undefined {
  try {
    assertUrlSafeIdentifier(sessionId, "sessionId");
  } catch (error) {
    return errorMessage(error, "invalid route sessionId");
  }
}

function badRequest(message: string): Response {
  return jsonResponse({ error: { message } }, 400);
}

function methodNotAllowed(): Response {
  return jsonResponse({ error: { message: "method not allowed" } }, 405);
}

function notFound(): Response {
  return jsonResponse(
    { error: { message: "coordinator session was not found" } },
    404
  );
}

function conflict(): Response {
  return jsonResponse(
    { error: { message: "coordinator session changed during mutation" } },
    409
  );
}

function eventRouteResult(
  result: Awaited<ReturnType<typeof routeStoredS3CoordinatorUploadEvent>>
): StoredS3CoordinatorEventRouteResponseResult {
  if (result.status === "committed" || result.status === "idempotent") {
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
  if (result.status === "committed" || result.status === "idempotent") {
    return {
      commit: result.commit.commit,
      ...(result.commit.cursor === undefined
        ? {}
        : { cursor: result.commit.cursor }),
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

  return {
    slotId: result.slot.slotId,
    status: result.status,
  };
}

function mediaObjectKindField(value: Record<string, unknown>): MediaObjectKind {
  const kind = stringField(value, "kind");

  if (!MEDIA_OBJECT_KINDS.includes(kind as MediaObjectKind)) {
    throw new Error(`kind must be one of: ${MEDIA_OBJECT_KINDS.join(", ")}`);
  }

  return kind as MediaObjectKind;
}

function publicationModeField(value: Record<string, unknown>): PublicationMode {
  const publicationMode = stringField(value, "publicationMode");

  if (!PUBLICATION_MODES.includes(publicationMode as PublicationMode)) {
    throw new Error(
      `publicationMode must be one of: ${PUBLICATION_MODES.join(", ")}`
    );
  }

  return publicationMode as PublicationMode;
}

function optionalPositiveIntegerField(
  value: Record<string, unknown>,
  field: "maxSegments"
): Partial<Pick<S3CommitPayload, "maxSegments">> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: positiveIntegerField(value, field) };
}

function optionalNonNegativeNumberField(
  value: Record<string, unknown>,
  field: "lateToleranceMs" | "size"
): Partial<Record<typeof field, number>> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: nonNegativeNumberField(value, field) };
}

function optionalNonNegativeIntegerField(
  value: Record<string, unknown>,
  field: "minBytes" | "partNumber"
): Partial<Pick<RuntimeSlotIssuePayload, "minBytes" | "partNumber">> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: nonNegativeIntegerField(value, field) };
}

function optionalBooleanField(
  value: Record<string, unknown>,
  field: "independent"
): Partial<Pick<S3CommitPayload, "independent">> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: booleanField(value, field) };
}

function optionalObjectKeyField(
  value: Record<string, unknown>
): Partial<Pick<S3CommitPayload, "objectKey">> {
  if (value.objectKey === undefined) {
    return {};
  }

  const objectKey = stringField(value, "objectKey");
  assertSafeObjectKey(objectKey, "objectKey");

  return { objectKey };
}

function optionalStringField<Field extends "etag" | "versionId">(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, string>> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: stringField(value, field) } as Partial<
    Record<Field, string>
  >;
}

function optionalUrlSafeIdentifierField(
  value: Record<string, unknown>,
  field: "commitId"
): string | undefined {
  if (value[field] === undefined) {
    return;
  }

  return urlSafeIdentifierField(value, field);
}

function optionalTimestampValueField(
  value: Record<string, unknown>,
  field: "committedAt"
): string | undefined {
  if (value[field] === undefined) {
    return;
  }

  return timestampField(value, field);
}

function optionalTimestampField<Field extends "programDateTime">(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, string>> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: timestampField(value, field) } as Partial<
    Record<Field, string>
  >;
}

function optionalStringArrayField(
  value: Record<string, unknown>,
  field: "slotIds"
): Partial<Pick<S3ReconciliationPayload, "slotIds">> {
  if (value[field] === undefined) {
    return {};
  }

  if (
    !(
      Array.isArray(value[field]) &&
      value[field].every((entry) => typeof entry === "string")
    )
  ) {
    throw new Error(`${field} must be a string array`);
  }

  return { [field]: value[field] };
}

function optionalUrlSafeIdentifierArrayField(
  value: Record<string, unknown>,
  field: "slotIds"
): Partial<Pick<S3ReconciliationPayload, "slotIds">> {
  const result = optionalStringArrayField(value, field);

  for (const entry of result[field] ?? []) {
    assertUrlSafeIdentifier(entry, field);
  }

  return result;
}

function providerIdField(
  value: Record<string, unknown>,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): string {
  if (value.providerId !== undefined) {
    return urlSafeIdentifierField(value, "providerId");
  }

  if (options.providerId !== undefined) {
    assertUrlSafeIdentifier(options.providerId, "providerId");

    return options.providerId;
  }

  throw new Error("providerId must be configured or provided");
}
