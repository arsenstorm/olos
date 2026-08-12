import {
  parseCommitTimestamp,
  parseCommitTimestampOrNow,
  parseOptionalUrlSafeIdentifierArrayField,
} from "../runtime/commit-payload-parser";
import {
  optionalNonNegativeNumberField,
  optionalStringField,
  timestampField,
} from "../runtime/request-fields";
import { errorMessage, isRecord } from "../validation/fields";
import {
  type ParsedS3CommitPayload,
  type ParsedS3ReconciliationPayload,
  parseS3CommitPayload,
  parseS3CommitPayloadRequest,
  parseS3ReconciliationPayloadRequest,
} from "./commit-payload-parser";
import { createCompletionHintDefaults } from "./completion-hint";
import type { CreateStoredS3CoordinatorRuntimeHandlerOptions } from "./http-types";

interface InvalidS3HttpRequestParse {
  message: string;
  status: "invalid";
}

type S3HttpRequestParse<Payload> =
  | { payload: Payload; status: "valid" }
  | InvalidS3HttpRequestParse;

type S3CommitPayload = ParsedS3CommitPayload;
type S3ReconciliationPayload = ParsedS3ReconciliationPayload;

interface S3ReconciliationPlanPayload {
  slotIds?: readonly string[];
}

interface S3RetentionPayload {
  now: string;
}

export function parseS3CompletionHintRequest(
  request: Request,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions,
  slotId: string
): Promise<S3HttpRequestParse<S3CommitPayload>> {
  return parseRecordRequest(
    request,
    "S3 completion hint request",
    "invalid S3 completion hint request",
    (payload) => parseCompletionHintPayload(payload, options, slotId)
  );
}

export async function parseS3CommitRequest(
  request: Request,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Promise<S3HttpRequestParse<S3CommitPayload>> {
  const parsed = await parseS3CommitPayloadRequest(request, {
    fallbackMessage: "invalid S3 slot grant request",
    invalid,
    parseCommittedAt: parseCommitTimestamp,
    payloadName: "S3 commit request",
    provider: options,
  });

  return parsed.status === "invalid"
    ? parsed
    : { payload: parsed.value, status: "valid" };
}

export function parseS3ReconciliationPlanRequest(
  request: Request
): Promise<S3HttpRequestParse<S3ReconciliationPlanPayload>> {
  return parseRecordRequest(
    request,
    "S3 reconciliation plan request",
    "invalid S3 reconciliation plan request",
    (payload) => ({
      ...parseOptionalUrlSafeIdentifierArrayField(payload, "slotIds"),
    })
  );
}

export async function parseS3ReconciliationRequest(
  request: Request,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Promise<S3HttpRequestParse<S3ReconciliationPayload>> {
  const parsed = await parseS3ReconciliationPayloadRequest(request, {
    fallbackMessage: "invalid S3 reconciliation request",
    invalid,
    parseCommittedAt: parseCommitTimestamp,
    payloadName: "S3 reconciliation request",
    provider: options,
  });

  return parsed.status === "invalid"
    ? parsed
    : { payload: parsed.value, status: "valid" };
}

export function parseS3RetentionRequest(
  request: Request
): Promise<S3HttpRequestParse<S3RetentionPayload>> {
  return parseRecordRequest(
    request,
    "S3 retention request",
    "invalid S3 retention request",
    (payload) => ({
      now: timestampField(payload, "now"),
    })
  );
}

export async function parseJsonRequest(
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

async function parseRecordRequest<Payload>(
  request: Request,
  name: string,
  fallbackMessage: string,
  parsePayload: (value: Record<string, unknown>) => Payload
): Promise<S3HttpRequestParse<Payload>> {
  const parsed = await parseRecordJsonRequest(request, name, fallbackMessage);

  if (parsed.status === "invalid") {
    return parsed;
  }

  return parseRecordPayload(parsed.payload, fallbackMessage, parsePayload);
}

async function parseRecordJsonRequest(
  request: Request,
  name: string,
  fallbackMessage: string
): Promise<S3HttpRequestParse<Record<string, unknown>>> {
  try {
    return recordJsonRequestPayload(await request.json(), name);
  } catch (error) {
    return invalid(errorMessage(error, fallbackMessage));
  }
}

function recordJsonRequestPayload(
  payload: unknown,
  name: string
): S3HttpRequestParse<Record<string, unknown>> {
  if (!isRecord(payload)) {
    return invalid(`${name} must be a JSON object`);
  }

  return {
    payload,
    status: "valid",
  };
}

function parseRecordPayload<Payload>(
  payload: Record<string, unknown>,
  fallbackMessage: string,
  parsePayload: (value: Record<string, unknown>) => Payload
): S3HttpRequestParse<Payload> {
  try {
    return {
      payload: parsePayload(payload),
      status: "valid",
    };
  } catch (error) {
    return invalid(errorMessage(error, fallbackMessage));
  }
}

function invalid(message: string): InvalidS3HttpRequestParse {
  return { message, status: "invalid" };
}

function assertNoCompletionHintDeliveryUrl(
  value: Record<string, unknown>
): void {
  if (value.deliveryUrl !== undefined) {
    throw new Error("completion hint must not include deliveryUrl");
  }
}

export type { S3HttpRequestParse };
