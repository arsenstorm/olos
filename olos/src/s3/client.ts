import type { RuntimeFetch } from "../runtime/client";
import {
  fetchFor,
  isRecord,
  jsonPost,
  normalizedBaseUrl,
  optionalRecordPayload,
  recordPayload,
  requiredRecordField,
  responseBody,
} from "../runtime/http-client";
import type { RuntimeSlotIssuePayload } from "../runtime/slot";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import { assertUrlSafeIdentifier } from "../validation/ids";
import type {
  StoredS3CoordinatorReconciliationResponse,
  StoredS3CoordinatorRetentionResponse,
} from "./http";
import type { StoredS3CoordinatorReconciliationPlan } from "./reconciliation";

export interface S3RuntimeHttpClientOptions {
  baseUrl: string;
  fetch?: RuntimeFetch;
}

export class S3RuntimeHttpError extends Error {
  readonly body: unknown;
  readonly response: Response;
  readonly status: number;

  constructor(message: string, response: Response, body: unknown) {
    super(message);
    this.body = body;
    this.name = "S3RuntimeHttpError";
    this.response = response;
    this.status = response.status;
  }
}

export interface S3RuntimeIssueUploadGrantOptions
  extends S3RuntimeHttpClientOptions {
  payload: RuntimeSlotIssuePayload;
  sessionId: string;
}

export interface S3RuntimeCompleteUploadOptions
  extends S3RuntimeHttpClientOptions {
  payload?: S3RuntimeCompletionHintPayload;
  sessionId: string;
  slotId: string;
}

export interface S3RuntimeCommitUploadOptions
  extends S3RuntimeHttpClientOptions {
  payload: S3RuntimeCommitPayload;
  sessionId: string;
}

export interface S3RuntimePlanReconciliationOptions
  extends S3RuntimeHttpClientOptions {
  payload?: S3RuntimeReconciliationPlanPayload;
  sessionId: string;
}

export interface S3RuntimeReconcileUploadsOptions
  extends S3RuntimeHttpClientOptions {
  payload: S3RuntimeReconciliationPayload;
  sessionId: string;
}

export interface S3RuntimeApplyRetentionOptions
  extends S3RuntimeHttpClientOptions {
  payload: S3RuntimeRetentionPayload;
  sessionId: string;
}

export interface S3RuntimeCommitPayload {
  commitId: string;
  committedAt: string;
  independent?: boolean;
  lateToleranceMs?: number;
  maxSegments?: number;
  objectKey?: string;
  programDateTime?: string;
  providerId?: string;
  slotId: string;
  versionId?: string;
}

export interface S3RuntimeReconciliationPayload {
  committedAt: string;
  independent?: boolean;
  lateToleranceMs?: number;
  maxSegments?: number;
  programDateTime?: string;
  providerId?: string;
  slotIds?: readonly string[];
  versionId?: string;
}

export interface S3RuntimeReconciliationPlanPayload {
  slotIds?: readonly string[];
}

export interface S3RuntimeRetentionPayload {
  now: string;
}

export interface S3RuntimeCompletionHintPayload {
  commitId?: string;
  committedAt?: string;
  etag?: string;
  independent?: boolean;
  lateToleranceMs?: number;
  maxSegments?: number;
  objectKey?: string;
  programDateTime?: string;
  providerId?: string;
  size?: number;
  versionId?: string;
}

export interface S3RuntimeIssueUploadGrantResponse {
  grant: UploadGrant;
  response: Response;
  slot: UploadSlot;
}

export interface S3RuntimeCompleteUploadResponse {
  commit: Commit;
  cursor?: Cursor;
  response: Response;
}

export interface S3RuntimeCommitUploadResponse {
  commit: Commit;
  cursor?: Cursor;
  response: Response;
}

export type S3RuntimeReconciliationPlanResponse =
  StoredS3CoordinatorReconciliationPlan & {
    response: Response;
  };

export type S3RuntimeReconcileUploadsResponse =
  StoredS3CoordinatorReconciliationResponse & {
    response: Response;
  };

export type S3RuntimeApplyRetentionResponse =
  StoredS3CoordinatorRetentionResponse & {
    response: Response;
  };

export async function issueS3RuntimeUploadGrant(
  options: S3RuntimeIssueUploadGrantOptions
): Promise<S3RuntimeIssueUploadGrantResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, "s3/slots"),
    jsonPost(options.payload)
  );

  if (!response.ok) {
    throw await s3RuntimeHttpError("S3 upload grant issue", response);
  }

  return {
    ...grantPayload(await response.json()),
    response,
  };
}

export async function completeS3RuntimeUpload(
  options: S3RuntimeCompleteUploadOptions
): Promise<S3RuntimeCompleteUploadResponse> {
  const response = await fetchFor(options)(
    completionUrl(options.baseUrl, options.sessionId, options.slotId),
    jsonPost(options.payload ?? {})
  );

  if (!response.ok) {
    throw await s3RuntimeHttpError("S3 upload completion", response);
  }

  return {
    ...commitPayload(await response.json()),
    response,
  };
}

export async function commitS3RuntimeUpload(
  options: S3RuntimeCommitUploadOptions
): Promise<S3RuntimeCommitUploadResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, "s3/commits"),
    jsonPost(options.payload)
  );

  if (!response.ok) {
    throw await s3RuntimeHttpError("S3 upload commit", response);
  }

  return {
    ...commitPayload(await response.json()),
    response,
  };
}

export async function planS3RuntimeReconciliation(
  options: S3RuntimePlanReconciliationOptions
): Promise<S3RuntimeReconciliationPlanResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, "s3/reconcile-plan"),
    jsonPost(options.payload ?? {})
  );

  if (!response.ok) {
    throw await s3RuntimeHttpError("S3 reconciliation plan", response);
  }

  return {
    ...reconciliationPlanPayload(await response.json()),
    response,
  };
}

export async function reconcileS3RuntimeUploads(
  options: S3RuntimeReconcileUploadsOptions
): Promise<S3RuntimeReconcileUploadsResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, "s3/reconcile"),
    jsonPost(options.payload)
  );

  if (!response.ok) {
    throw await s3RuntimeHttpError("S3 upload reconciliation", response);
  }

  return {
    ...reconciliationPayload(await response.json()),
    response,
  };
}

export async function applyS3RuntimeRetention(
  options: S3RuntimeApplyRetentionOptions
): Promise<S3RuntimeApplyRetentionResponse> {
  const response = await fetchFor(options)(
    sessionUrl(options.baseUrl, options.sessionId, "s3/retention"),
    jsonPost(options.payload)
  );

  if (!response.ok) {
    throw await s3RuntimeHttpError("S3 retention", response);
  }

  return {
    ...retentionPayload(await response.json()),
    response,
  };
}

function sessionUrl(baseUrl: string, sessionId: string, action: string): URL {
  assertUrlSafeIdentifier(sessionId, "sessionId");

  return new URL(
    `sessions/${encodeURIComponent(sessionId)}/${action}`,
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
    `sessions/${encodeURIComponent(sessionId)}/upload-slots/${encodeURIComponent(
      slotId
    )}/complete`,
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

function grantPayload(
  value: unknown
): Omit<S3RuntimeIssueUploadGrantResponse, "response"> {
  const grant = requiredRecordField(
    value,
    "grant",
    "S3 upload grant response must include grant and slot"
  );
  const slot = requiredRecordField(
    value,
    "slot",
    "S3 upload grant response must include grant and slot"
  );

  return {
    grant: recordPayload<UploadGrant>(grant),
    slot: recordPayload<UploadSlot>(slot),
  };
}

function commitPayload(
  value: unknown
): Omit<S3RuntimeCompleteUploadResponse, "response"> {
  const commit = requiredRecordField(
    value,
    "commit",
    "S3 upload completion response must include a commit"
  );

  return {
    commit: recordPayload<Commit>(commit),
    ...optionalCursorPayload(value),
  };
}

function optionalCursorPayload(
  value: unknown
): Pick<S3RuntimeCompleteUploadResponse, "cursor"> | Record<string, never> {
  return optionalRecordPayload<"cursor", Cursor>(value, "cursor");
}

function reconciliationPlanPayload(
  value: unknown
): StoredS3CoordinatorReconciliationPlan {
  if (!(isRecord(value) && typeof value.status === "string")) {
    throw new Error("S3 reconciliation plan response must include status");
  }

  return recordPayload<StoredS3CoordinatorReconciliationPlan>(value);
}

function reconciliationPayload(
  value: unknown
): StoredS3CoordinatorReconciliationResponse {
  if (!(isRecord(value) && Array.isArray(value.results))) {
    throw new Error("S3 reconciliation response must include results");
  }

  return recordPayload<StoredS3CoordinatorReconciliationResponse>(value);
}

function retentionPayload(
  value: unknown
): StoredS3CoordinatorRetentionResponse {
  if (!isRecord(value)) {
    throw new Error("S3 retention response must include plan and summary");
  }

  requiredRecordField(
    value,
    "plan",
    "S3 retention response must include plan and summary"
  );
  requiredRecordField(
    value,
    "summary",
    "S3 retention response must include plan and summary"
  );

  return recordPayload<StoredS3CoordinatorRetentionResponse>(value);
}
