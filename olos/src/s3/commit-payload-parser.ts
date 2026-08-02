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

export interface S3CommitPayloadParseOverrides {
  commitId?: string;
  slotId?: string;
}

export interface ParsedS3CommitPayload {
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

export function parseS3CommitPayloadRequest<Invalid>(
  request: Request | ParsedS3CommitPayload,
  invalid: (message: string) => Invalid,
  fallbackMessage: string,
  options: ProviderIdOptions,
  parseCommittedAt: ParseTimestampField = parseCommitTimestamp,
  overrides: S3CommitPayloadParseOverrides = {},
  payloadName = "S3 commit request"
): Promise<S3CommitPayloadRequestParse<Invalid>> {
  return parseRuntimeJsonRequest(
    request,
    (value) =>
      parseS3CommitPayloadPayload(
        value,
        options,
        parseCommittedAt,
        overrides,
        payloadName
      ),
    invalid,
    fallbackMessage
  );
}

export function parseS3ReconciliationPayloadRequest<Invalid>(
  request: Request | ParsedS3ReconciliationPayload,
  invalid: (message: string) => Invalid,
  fallbackMessage: string,
  options: ProviderIdOptions,
  parseCommittedAt: ParseTimestampField = parseCommitTimestamp,
  payloadName = "S3 reconciliation request"
): Promise<S3ReconciliationPayloadRequestParse<Invalid>> {
  return parseRuntimeJsonRequest(
    request,
    (value) =>
      parseS3ReconciliationPayloadPayload(
        value,
        options,
        parseCommittedAt,
        payloadName
      ),
    invalid,
    fallbackMessage
  );
}

function parseS3CommitPayloadPayload(
  value: unknown,
  options: ProviderIdOptions,
  parseCommittedAt: ParseTimestampField,
  overrides: S3CommitPayloadParseOverrides,
  payloadName: string
): ParsedS3CommitPayload {
  return parseS3CommitPayload(
    parseRecordPayload(value, payloadName),
    options,
    parseCommittedAt,
    overrides
  );
}

function parseS3ReconciliationPayloadPayload(
  value: unknown,
  options: ProviderIdOptions,
  parseCommittedAt: ParseTimestampField,
  payloadName: string
): ParsedS3ReconciliationPayload {
  return parseS3ReconciliationPayload(
    parseRecordPayload(value, payloadName),
    options,
    parseCommittedAt
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
