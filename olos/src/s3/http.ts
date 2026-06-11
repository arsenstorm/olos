import type { S3Client } from "@aws-sdk/client-s3";
import type { RuntimeSlotIssuePayload } from "../runtime";
import {
  type CreateStoredCoordinatorRuntimeHandlerOptions,
  createStoredCoordinatorRuntimeHandler,
} from "../runtime";
import type { MediaObjectKind } from "../types/media-object";
import type { PublicationMode } from "../types/upload-slot";
import {
  completeStoredS3CoordinatorUpload,
  issueStoredS3CoordinatorUploadGrant,
} from "./coordinator";
import type { S3HeadObjectClient } from "./object-observation";

const DEFAULT_SESSION_PATH = "/sessions";

export interface CreateStoredS3CoordinatorRuntimeHandlerOptions
  extends CreateStoredCoordinatorRuntimeHandlerOptions {
  additionalHeaders?: Record<string, string>;
  bucket: string;
  client: S3Client;
  expiresInSeconds: number;
  grantNow?: () => Date | string;
  objectClient?: S3HeadObjectClient;
}

export type StoredS3CoordinatorRuntimeHandler = (
  request: Request
) => Promise<Response>;

export function createStoredS3CoordinatorRuntimeHandler(
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): StoredS3CoordinatorRuntimeHandler {
  const baseHandler = createStoredCoordinatorRuntimeHandler(options);

  return async (request) => {
    const route = s3Route(request, options);

    if (route.status === "not_s3") {
      return await baseHandler(request);
    }

    if (route.status === "method_not_allowed") {
      return methodNotAllowed();
    }

    if (route.action === "slots") {
      return await handleS3SlotGrant(request, route.sessionId, options);
    }

    return await handleS3Commit(request, route.sessionId, options);
  };
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
    return jsonResponse({ grant: result.grant, slot: result.slot }, 201);
  }

  if (result.status === "not_found") {
    return notFound();
  }

  if (result.status === "rejected") {
    return jsonResponse(result.error, rejectionStatus(result.error.error.code));
  }

  return conflict();
}

async function handleS3Commit(
  request: Request,
  sessionId: string,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Promise<Response> {
  const parsed = await parseS3CommitRequest(request);

  if (parsed.status === "invalid") {
    return badRequest(parsed.message);
  }

  const result = await completeStoredS3CoordinatorUpload({
    ...parsed.payload,
    bucket: options.bucket,
    client: options.objectClient ?? options.client,
    maxAttempts: options.maxAttempts,
    publicationControl: options.publicationControl,
    sessionId,
    store: options.store,
  });

  if (result.status === "committed" || result.status === "idempotent") {
    return jsonResponse(
      {
        commit: result.commit,
        ...(result.cursor === undefined ? {} : { cursor: result.cursor }),
      },
      result.status === "committed" ? 201 : 200
    );
  }

  if (result.status === "rejected") {
    return jsonResponse(result.error, rejectionStatus(result.error.error.code));
  }

  if (result.status === "not_found") {
    return notFound();
  }

  return conflict();
}

type S3Route =
  | { action: "commits" | "slots"; sessionId: string; status: "matched" }
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

  const [sessionId, provider, action] = parts;

  if (
    sessionId === undefined ||
    provider !== "s3" ||
    (action !== "slots" && action !== "commits") ||
    parts.length !== 3
  ) {
    return { status: "not_s3" };
  }

  if (request.method !== "POST") {
    return { status: "method_not_allowed" };
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
    return invalid(errorMessage(error));
  }
}

function parsePayload(value: Record<string, unknown>): RuntimeSlotIssuePayload {
  return {
    contentType: stringField(value, "contentType"),
    deliveryUrl: stringField(value, "deliveryUrl"),
    duration: numberField(value, "duration"),
    expiresAt: stringField(value, "expiresAt"),
    kind: stringField(value, "kind") as MediaObjectKind,
    maxBytes: numberField(value, "maxBytes"),
    mediaSequenceNumber: numberField(value, "mediaSequenceNumber"),
    objectKey: stringField(value, "objectKey"),
    publicationMode: stringField(value, "publicationMode") as PublicationMode,
    publisherInstanceId: stringField(value, "publisherInstanceId"),
    renditionId: stringField(value, "renditionId"),
    slotId: stringField(value, "slotId"),
    ...optionalNumberField(value, "minBytes"),
    ...optionalNumberField(value, "partNumber"),
  };
}

interface S3CommitPayload {
  commitId: string;
  committedAt: string;
  independent?: boolean;
  maxSegments?: number;
  objectKey?: string;
  programDateTime?: string;
  providerId: string;
  slotId: string;
  versionId?: string;
}

async function parseS3CommitRequest(
  request: Request
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
      payload: parseCommitPayload(payload),
      status: "valid",
    };
  } catch (error) {
    return invalid(errorMessage(error));
  }
}

function parseCommitPayload(value: Record<string, unknown>): S3CommitPayload {
  return {
    commitId: stringField(value, "commitId"),
    committedAt: stringField(value, "committedAt"),
    providerId: stringField(value, "providerId"),
    slotId: stringField(value, "slotId"),
    ...optionalBooleanField(value, "independent"),
    ...optionalNumberField(value, "maxSegments"),
    ...optionalStringField(value, "objectKey"),
    ...optionalStringField(value, "programDateTime"),
    ...optionalStringField(value, "versionId"),
  };
}

function routeParts(
  pathname: string,
  routePath: string
): readonly string[] | undefined {
  const normalized = normalizePath(routePath);

  if (pathname !== normalized && !pathname.startsWith(`${normalized}/`)) {
    return;
  }

  return pathname
    .slice(normalized.length)
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
}

function normalizePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;

  return normalized.endsWith("/") && normalized.length > 1
    ? normalized.slice(0, -1)
    : normalized;
}

function invalid(message: string): { message: string; status: "invalid" } {
  return { message, status: "invalid" };
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

function rejectionStatus(code: string): number {
  return code === "olos.unknown_slot" ? 404 : 409;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, field: string): string {
  if (typeof value[field] !== "string") {
    throw new Error(`${field} must be a string`);
  }

  return value[field];
}

function numberField(value: Record<string, unknown>, field: string): number {
  if (typeof value[field] !== "number" || !Number.isFinite(value[field])) {
    throw new Error(`${field} must be a finite number`);
  }

  return value[field];
}

function optionalNumberField(
  value: Record<string, unknown>,
  field: "maxSegments" | "minBytes" | "partNumber"
): Partial<
  Pick<RuntimeSlotIssuePayload, "minBytes" | "partNumber"> &
    Pick<S3CommitPayload, "maxSegments">
> {
  if (value[field] === undefined) {
    return {};
  }

  return { [field]: numberField(value, field) };
}

function optionalBooleanField(
  value: Record<string, unknown>,
  field: "independent"
): Partial<Pick<S3CommitPayload, "independent">> {
  if (value[field] === undefined) {
    return {};
  }

  if (typeof value[field] !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }

  return { [field]: value[field] };
}

function optionalStringField<
  Field extends "objectKey" | "programDateTime" | "versionId",
>(
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

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "invalid S3 slot grant request";
}
