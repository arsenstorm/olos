import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertSafeObjectKey } from "../validation/object-key";
import { optionalField } from "./optional-field";
import {
  isRecord,
  optionalBooleanField,
  optionalNonNegativeNumberField,
  optionalPositiveIntegerField,
  optionalStringField,
  optionalTimestampField,
  optionalTimestampValueField,
  positiveNumberField,
  stringField,
  timestampField,
  urlSafeIdentifierField,
} from "./request-fields";

export type ParseTimestampField = (
  value: Record<string, unknown>,
  field: string
) => string;

export interface CommitPayloadTiming {
  independent?: boolean;
  lateToleranceMs?: number;
  maxSegments?: number;
  programDateTime?: string;
}

export interface ParsedCommitPayload extends CommitPayloadTiming {
  commitId: string;
  committedAt: string;
  slotId: string;
}

export interface ProviderResolvedCommitPayload extends CommitPayloadTiming {
  committedAt: string;
  providerId: string;
}

export interface ProviderIdOptions {
  providerId?: string;
}

export interface ParsedObservedUploadPayload {
  contentType: string;
  etag?: string;
  metadata?: Record<string, string | undefined>;
  objectKey: string;
  observedAt: string;
  providerId: string;
  size: number;
}

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

export function parseObservedUploadPayload(
  value: unknown,
  objectField = "object"
): ParsedObservedUploadPayload {
  if (!isRecord(value)) {
    throw new Error(`${objectField} must be a JSON object`);
  }

  return {
    contentType: stringField(value, "contentType"),
    ...optionalStringField(value, "etag"),
    objectKey: parseSafeObjectKeyField(
      value,
      "objectKey",
      `${objectField}.objectKey`
    ),
    observedAt: timestampField(value, "observedAt"),
    providerId: urlSafeIdentifierField(value, "providerId"),
    size: positiveNumberField(value, "size"),
    ...optionalMetadataField(value, `${objectField}.metadata`),
  };
}

export function parseCommitTimestamp(
  value: Record<string, unknown>,
  field: string
): string {
  return timestampField(value, field);
}

export function parseCommitTimestampOrNow(
  value: Record<string, unknown>,
  field: string,
  now: () => string
): string {
  return optionalTimestampValueField(value, field) ?? now();
}

export function parseProviderId(
  value: Record<string, unknown>,
  options: ProviderIdOptions,
  field = "providerId",
  missingError = `${field} must be configured or provided`
): string {
  if (value[field] !== undefined) {
    return urlSafeIdentifierField(value, field);
  }

  if (options.providerId !== undefined) {
    assertUrlSafeIdentifier(options.providerId, field);
    return options.providerId;
  }

  throw new Error(missingError);
}

export function parseSafeObjectKeyField(
  value: Record<string, unknown>,
  field: string,
  errorField = field
): string {
  const objectKey = stringField(value, field);

  assertSafeObjectKey(objectKey, errorField);

  return objectKey;
}

export function parseCommitPayloadTiming(
  value: Record<string, unknown>
): CommitPayloadTiming {
  return {
    ...optionalBooleanField(value, "independent"),
    ...optionalNonNegativeNumberField(value, "lateToleranceMs"),
    ...optionalPositiveIntegerField(value, "maxSegments"),
    ...optionalTimestampField(value, "programDateTime"),
  };
}

export function parseCommitRequestPayload(
  value: Record<string, unknown>,
  parseCommittedAt: ParseTimestampField = parseCommitTimestamp
): ParsedCommitPayload {
  return {
    commitId: urlSafeIdentifierField(value, "commitId"),
    committedAt: parseCommittedAt(value, "committedAt"),
    slotId: urlSafeIdentifierField(value, "slotId"),
    ...parseCommitPayloadTiming(value),
  };
}

export function parseProviderResolvedCommitPayload(
  value: Record<string, unknown>,
  options: ProviderIdOptions,
  parseCommittedAt: ParseTimestampField = parseCommitTimestamp,
  field = "providerId",
  missingError = `${field} must be configured or provided`
): ProviderResolvedCommitPayload {
  return {
    committedAt: parseCommittedAt(value, "committedAt"),
    providerId: parseProviderId(value, options, field, missingError),
    ...parseCommitPayloadTiming(value),
  };
}

export function parseS3CommitPayload(
  value: Record<string, unknown>,
  options: ProviderIdOptions,
  parseCommittedAt: ParseTimestampField = parseCommitTimestamp,
  overrides: S3CommitPayloadParseOverrides = {}
): ParsedS3CommitPayload {
  return {
    ...parseProviderResolvedCommitPayload(value, options, parseCommittedAt),
    commitId: overrides.commitId ?? urlSafeIdentifierField(value, "commitId"),
    slotId: overrides.slotId ?? urlSafeIdentifierField(value, "slotId"),
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

export function parseOptionalSafeObjectKeyField<const Field extends string>(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, string>> {
  if (value[field] === undefined) {
    return {};
  }

  return optionalField(field, parseSafeObjectKeyField(value, field));
}

export function parseOptionalUrlSafeIdentifierArrayField<
  const Field extends string,
>(
  value: Record<string, unknown>,
  field: Field
): Partial<Record<Field, string[]>> {
  const rawValue = value[field];

  if (rawValue === undefined) {
    return {};
  }

  const fieldValue = optionalUrlSafeIdentifierArray(rawValue, field);

  return optionalField(field, fieldValue);
}

function optionalUrlSafeIdentifierArray(
  value: unknown,
  field: string
): string[] {
  if (!isStringArray(value)) {
    throw new Error(`${field} must be a string array`);
  }

  for (const entry of value) {
    assertUrlSafeIdentifier(entry, field);
  }

  return value;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function isMetadata(
  value: unknown
): value is Record<string, string | undefined> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry) => typeof entry === "string" || entry === undefined
    )
  );
}

function optionalMetadataField(
  value: Record<string, unknown>,
  metadataField: string
): Pick<ParsedObservedUploadPayload, "metadata"> | Record<string, never> {
  if (value.metadata === undefined) {
    return {};
  }

  if (!isMetadata(value.metadata)) {
    throw new Error(`${metadataField} must be a string map`);
  }

  return { metadata: value.metadata };
}
