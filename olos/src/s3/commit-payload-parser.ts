import {
  type ParseTimestampField,
  type ProviderIdOptions,
  type ProviderResolvedCommitPayload,
  parseCommitTimestamp,
  parseOptionalSafeObjectKeyField,
  parseOptionalUrlSafeIdentifierArrayField,
  parseProviderResolvedCommitPayload,
  parseRecordPayload,
} from "../runtime/commit-payload-parser";
import {
  optionalStringField,
  urlSafeIdentifierField,
} from "../runtime/request-fields";
import {
  parseRuntimeJsonRequest,
  type RuntimeJsonRequestParse,
} from "../runtime/request-json";
import type { ProfileData } from "../types/profile";

export interface S3CommitPayloadParseOverrides {
  commitId?: string;
  slotId?: string;
}

export interface ParsedS3CommitPayload {
  commitId: string;
  committedAt: string;
  lateToleranceMs?: number;
  maxSegments?: number;
  objectKey?: string;
  /** Profile-defined facts about the object, merged over the slot profile. */
  profile?: ProfileData;
  providerId: string;
  slotId: string;
  versionId?: string;
}

export interface ParsedS3ReconciliationPayload
  extends ProviderResolvedCommitPayload {
  slotIds?: readonly string[];
  versionId?: string;
}

type ParsedS3CommitIdentity = Pick<
  ParsedS3CommitPayload,
  "commitId" | "slotId"
>;

type ParsedS3CommitObjectHints = Partial<
  Pick<ParsedS3CommitPayload, "objectKey" | "versionId">
>;

export type S3CommitPayloadRequestParse<Invalid> = RuntimeJsonRequestParse<
  ParsedS3CommitPayload,
  Invalid
>;

export type S3ReconciliationPayloadRequestParse<Invalid> =
  RuntimeJsonRequestParse<ParsedS3ReconciliationPayload, Invalid>;

/**
 * How to turn a request body into a parsed payload, and how to report a body
 * that will not parse. `parseCommittedAt`, `overrides`, and `payloadName`
 * carry the same defaults the individual parsers use.
 */
export interface ParseS3PayloadRequestOptions<Invalid> {
  /** Message used when the body is not readable as JSON at all. */
  fallbackMessage: string;
  invalid: (message: string) => Invalid;
  parseCommittedAt?: ParseTimestampField;
  payloadName?: string;
  provider: ProviderIdOptions;
}

export interface ParseS3CommitPayloadRequestOptions<Invalid>
  extends ParseS3PayloadRequestOptions<Invalid> {
  overrides?: S3CommitPayloadParseOverrides;
}

export function parseS3CommitPayloadRequest<Invalid>(
  request: Request | ParsedS3CommitPayload,
  options: ParseS3CommitPayloadRequestOptions<Invalid>
): Promise<S3CommitPayloadRequestParse<Invalid>> {
  const payloadName = options.payloadName ?? "S3 commit request";

  return parseRuntimeJsonRequest(
    request,
    (value) =>
      parseS3CommitPayload(
        parseRecordPayload(value, payloadName),
        options.provider,
        options.parseCommittedAt,
        options.overrides
      ),
    options.invalid,
    options.fallbackMessage
  );
}

export function parseS3ReconciliationPayloadRequest<Invalid>(
  request: Request | ParsedS3ReconciliationPayload,
  options: ParseS3PayloadRequestOptions<Invalid>
): Promise<S3ReconciliationPayloadRequestParse<Invalid>> {
  const payloadName = options.payloadName ?? "S3 reconciliation request";

  return parseRuntimeJsonRequest(
    request,
    (value) =>
      parseS3ReconciliationPayload(
        parseRecordPayload(value, payloadName),
        options.provider,
        options.parseCommittedAt
      ),
    options.invalid,
    options.fallbackMessage
  );
}

export function parseS3CommitPayload(
  value: Record<string, unknown>,
  options: ProviderIdOptions,
  parseCommittedAt: ParseTimestampField = parseCommitTimestamp,
  overrides: S3CommitPayloadParseOverrides = {}
): ParsedS3CommitPayload {
  return {
    ...parseProviderResolvedCommitPayload(value, options, parseCommittedAt),
    ...parseS3CommitIdentity(value, overrides),
    ...parseS3CommitObjectHints(value),
  };
}

function parseS3CommitIdentity(
  value: Record<string, unknown>,
  overrides: S3CommitPayloadParseOverrides
): ParsedS3CommitIdentity {
  return {
    commitId: overrides.commitId ?? urlSafeIdentifierField(value, "commitId"),
    slotId: overrides.slotId ?? urlSafeIdentifierField(value, "slotId"),
  };
}

function parseS3CommitObjectHints(
  value: Record<string, unknown>
): ParsedS3CommitObjectHints {
  return {
    ...parseOptionalSafeObjectKeyField(value, "objectKey"),
    ...optionalStringField(value, "versionId"),
  };
}

export function parseS3ReconciliationPayload(
  value: Record<string, unknown>,
  options: ProviderIdOptions,
  parseCommittedAt: ParseTimestampField = parseCommitTimestamp
): ParsedS3ReconciliationPayload {
  return {
    ...parseProviderResolvedCommitPayload(value, options, parseCommittedAt),
    ...optionalStringField(value, "versionId"),
    ...parseOptionalUrlSafeIdentifierArrayField(value, "slotIds"),
  };
}
