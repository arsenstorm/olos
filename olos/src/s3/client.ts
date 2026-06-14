import type { RuntimeFetch } from "../runtime/client";
import type { RuntimeSlotIssuePayload } from "../runtime/slot";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";

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

function sessionUrl(baseUrl: string, sessionId: string, action: string): URL {
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
  return new URL(
    `sessions/${encodeURIComponent(sessionId)}/upload-slots/${encodeURIComponent(
      slotId
    )}/complete`,
    normalizedBaseUrl(baseUrl)
  );
}

function jsonPost(body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  };
}

function normalizedBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function fetchFor(options: S3RuntimeHttpClientOptions): RuntimeFetch {
  return options.fetch ?? fetch;
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

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.clone().text();

  if (text.length === 0) {
    return;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function grantPayload(
  value: unknown
): Omit<S3RuntimeIssueUploadGrantResponse, "response"> {
  if (!(isRecord(value) && isRecord(value.grant) && isRecord(value.slot))) {
    throw new Error("S3 upload grant response must include grant and slot");
  }

  return {
    grant: value.grant as unknown as UploadGrant,
    slot: value.slot as unknown as UploadSlot,
  };
}

function commitPayload(
  value: unknown
): Omit<S3RuntimeCompleteUploadResponse, "response"> {
  if (!(isRecord(value) && isRecord(value.commit))) {
    throw new Error("S3 upload completion response must include a commit");
  }

  return {
    commit: value.commit as unknown as Commit,
    ...(isRecord(value.cursor)
      ? { cursor: value.cursor as unknown as Cursor }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
