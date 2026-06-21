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
import { errorMessage } from "../runtime/errors";
import {
  isRecord,
  optionalNonNegativeNumberField,
  optionalStringField,
  timestampField,
} from "../runtime/request-fields";
import type { CreateStoredS3CoordinatorRuntimeHandlerOptions } from "./http";

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

export async function parseS3ReconciliationPlanRequest(
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

export async function parseS3ReconciliationRequest(
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

export async function parseS3RetentionRequest(
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

export type { S3HttpRequestParse };
