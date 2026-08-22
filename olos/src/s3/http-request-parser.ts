import {
  parseCommitTimestamp,
  parseCommitTimestampOrNow,
  parseOptionalUrlSafeIdentifierArrayField,
} from "../runtime/commit-payload-parser";
import { timestampField } from "../runtime/request-fields";
import {
  boundedJsonRequestBody,
  isRuntimeJsonBodyTooLarge,
} from "../runtime/request-json";
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
  /** Set when the request body exceeded the configured byte cap. */
  tooLarge?: true;
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
    (payload) => parseCompletionHintPayload(payload, options, slotId),
    options.maxBodyBytes
  );
}

export async function parseS3CommitRequest(
  request: Request,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Promise<S3HttpRequestParse<S3CommitPayload>> {
  const parsed = await parseS3CommitPayloadRequest(request, {
    fallbackMessage: "invalid S3 slot grant request",
    invalid,
    maxBodyBytes: options.maxBodyBytes,
    parseCommittedAt: parseCommitTimestamp,
    payloadName: "S3 commit request",
    provider: options,
  });

  return parsed.status === "invalid"
    ? parsed
    : { payload: parsed.value, status: "valid" };
}

export function parseS3ReconciliationPlanRequest(
  request: Request,
  options?: Pick<CreateStoredS3CoordinatorRuntimeHandlerOptions, "maxBodyBytes">
): Promise<S3HttpRequestParse<S3ReconciliationPlanPayload>> {
  return parseRecordRequest(
    request,
    "S3 reconciliation plan request",
    "invalid S3 reconciliation plan request",
    (payload) => ({
      ...parseOptionalUrlSafeIdentifierArrayField(payload, "slotIds"),
    }),
    options?.maxBodyBytes
  );
}

export async function parseS3ReconciliationRequest(
  request: Request,
  options: CreateStoredS3CoordinatorRuntimeHandlerOptions
): Promise<S3HttpRequestParse<S3ReconciliationPayload>> {
  const parsed = await parseS3ReconciliationPayloadRequest(request, {
    fallbackMessage: "invalid S3 reconciliation request",
    invalid,
    maxBodyBytes: options.maxBodyBytes,
    parseCommittedAt: parseCommitTimestamp,
    payloadName: "S3 reconciliation request",
    provider: options,
  });

  return parsed.status === "invalid"
    ? parsed
    : { payload: parsed.value, status: "valid" };
}

export function parseS3RetentionRequest(
  request: Request,
  options?: Pick<CreateStoredS3CoordinatorRuntimeHandlerOptions, "maxBodyBytes">
): Promise<S3HttpRequestParse<S3RetentionPayload>> {
  return parseRecordRequest(
    request,
    "S3 retention request",
    "invalid S3 retention request",
    (payload) => ({
      now: timestampField(payload, "now"),
    }),
    options?.maxBodyBytes
  );
}

export async function parseJsonRequest(
  request: Request,
  name: string,
  maxBodyBytes?: number
): Promise<S3HttpRequestParse<unknown>> {
  try {
    return {
      payload: await boundedJsonRequestBody(request, maxBodyBytes),
      status: "valid",
    };
  } catch (error) {
    if (isRuntimeJsonBodyTooLarge(error)) {
      return invalid(error.message, "too_large");
    }

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
  assertNoCompletionHintObservedFields(value);

  return base;
}

async function parseRecordRequest<Payload>(
  request: Request,
  name: string,
  fallbackMessage: string,
  parsePayload: (value: Record<string, unknown>) => Payload,
  maxBodyBytes?: number
): Promise<S3HttpRequestParse<Payload>> {
  const parsed = await parseRecordJsonRequest(
    request,
    name,
    fallbackMessage,
    maxBodyBytes
  );

  if (parsed.status === "invalid") {
    return parsed;
  }

  return parseRecordPayload(parsed.payload, fallbackMessage, parsePayload);
}

async function parseRecordJsonRequest(
  request: Request,
  name: string,
  fallbackMessage: string,
  maxBodyBytes?: number
): Promise<S3HttpRequestParse<Record<string, unknown>>> {
  try {
    return recordJsonRequestPayload(
      await boundedJsonRequestBody(request, maxBodyBytes),
      name
    );
  } catch (error) {
    if (isRuntimeJsonBodyTooLarge(error)) {
      return invalid(error.message, "too_large");
    }

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

function invalid(
  message: string,
  status: "invalid" | "too_large" = "invalid"
): InvalidS3HttpRequestParse {
  return {
    message,
    status: "invalid",
    ...(status === "too_large" ? { tooLarge: true } : {}),
  };
}

function assertNoCompletionHintDeliveryUrl(
  value: Record<string, unknown>
): void {
  if (value.deliveryUrl !== undefined) {
    throw new Error("completion hint must not include deliveryUrl");
  }
}

// HeadObject is the only source of truth for observed object metadata; a
// hint cannot override what it reports.
function assertNoCompletionHintObservedFields(
  value: Record<string, unknown>
): void {
  for (const field of ["etag", "size"] as const) {
    if (value[field] !== undefined) {
      throw new Error(`completion hint must not include ${field}`);
    }
  }
}

export type { S3HttpRequestParse };
