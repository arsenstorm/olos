import type { ProfileData } from "../types/profile";
import { isRecord } from "../validation/fields";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertSafeObjectKey } from "../validation/object-key";
import {
  optionalField,
  optionalNonNegativeNumberField,
  optionalPositiveIntegerField,
  optionalProfileField,
  optionalStringField,
  optionalTimestampValueField,
  positiveNumberField,
  stringField,
  timestampField,
  urlSafeIdentifierField,
} from "./request-fields";
import {
  parseRuntimeJsonRequest,
  type RuntimeJsonRequestParse,
} from "./request-json";

export type ParseTimestampField = (
  value: Record<string, unknown>,
  field: string
) => string;

/** Optional commit fields shared by every commit payload shape. */
export interface CommitPayloadOptions {
  lateToleranceMs?: number;
  maxSegments?: number;
  /** Profile data recorded on the commit (opaque to Core). */
  profile?: ProfileData;
}

export interface ParsedCommitPayload extends CommitPayloadOptions {
  commitId: string;
  committedAt: string;
  slotId: string;
}

export interface ProviderResolvedCommitPayload extends CommitPayloadOptions {
  committedAt: string;
  providerId: string;
}

export interface ProviderIdOptions {
  providerId?: string;
}

/**
 * Description of an uploaded object as observed at the storage provider,
 * carried in a commit payload's `object` field.
 */
export interface ParsedObservedUploadPayload {
  contentType: string;
  /** Provider etag of the stored object, when the provider reports one. */
  etag?: string;
  /** Provider metadata attached to the object; string values only. */
  metadata?: Record<string, string | undefined>;
  objectKey: string;
  /** When the provider observed the upload, as an ISO 8601 timestamp. */
  observedAt: string;
  /** Storage provider that observed the upload. */
  providerId: string;
  /** Object size in bytes; must be positive. */
  size: number;
}

/**
 * Wire payload for committing an upload: the commit identity, optional
 * commit fields, and the observed object being committed.
 */
export interface RuntimeCommitPayload extends ParsedCommitPayload {
  object: ParsedObservedUploadPayload;
}

export type RuntimeCommitRequestParse<Invalid> = RuntimeJsonRequestParse<
  RuntimeCommitPayload,
  Invalid
>;

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

export function parseRuntimeCommitPayloadRequest<Invalid>(
  request: Request | RuntimeCommitPayload,
  invalid: (message: string) => Invalid,
  fallbackMessage: string,
  payloadName = "commit request"
): Promise<RuntimeCommitRequestParse<Invalid>> {
  return parseRuntimeJsonRequest(
    request,
    (value) => parseRuntimeCommitPayload(value, payloadName),
    invalid,
    fallbackMessage
  );
}

function parseRuntimeCommitPayload(
  value: unknown,
  payloadName: string
): RuntimeCommitPayload {
  const payload = parseRecordPayload(value, payloadName);

  return {
    ...parseCommitRequestPayload(payload),
    object: parseObservedUploadPayload(payload.object, "object"),
  };
}

export function parseRecordPayload(
  value: unknown,
  payloadName: string
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${payloadName} must be a JSON object`);
  }

  return value;
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
  const inlineProviderId = parseInlineProviderId(value, field);

  if (inlineProviderId !== undefined) {
    return inlineProviderId;
  }

  const configuredProviderId = parseConfiguredProviderId(options, field);

  if (configuredProviderId !== undefined) {
    return configuredProviderId;
  }

  throw new Error(missingError);
}

function parseInlineProviderId(
  value: Record<string, unknown>,
  field: string
): string | undefined {
  return value[field] === undefined
    ? undefined
    : urlSafeIdentifierField(value, field);
}

function parseConfiguredProviderId(
  options: ProviderIdOptions,
  field: string
): string | undefined {
  if (options.providerId === undefined) {
    return;
  }

  assertUrlSafeIdentifier(options.providerId, field);

  return options.providerId;
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

export function parseCommitPayloadOptions(
  value: Record<string, unknown>
): CommitPayloadOptions {
  return {
    ...optionalNonNegativeNumberField(value, "lateToleranceMs"),
    ...optionalPositiveIntegerField(value, "maxSegments"),
    ...optionalProfileField(value),
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
    ...parseCommitPayloadOptions(value),
  };
}

/** Overrides for how the provider id is read and reported when missing. */
export interface ProviderIdFieldOptions {
  field?: string;
  missingError?: string;
}

export function parseProviderResolvedCommitPayload(
  value: Record<string, unknown>,
  options: ProviderIdOptions,
  parseCommittedAt: ParseTimestampField = parseCommitTimestamp,
  providerIdField: ProviderIdFieldOptions = {}
): ProviderResolvedCommitPayload {
  const field = providerIdField.field ?? "providerId";

  return {
    committedAt: parseCommittedAt(value, "committedAt"),
    providerId: parseProviderId(
      value,
      options,
      field,
      providerIdField.missingError ?? `${field} must be configured or provided`
    ),
    ...parseCommitPayloadOptions(value),
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
  assertStringArray(value, field);
  assertUrlSafeIdentifierArrayEntries(value, field);

  return value;
}

function assertStringArray(
  value: unknown,
  field: string
): asserts value is string[] {
  if (!isStringArray(value)) {
    throw new Error(`${field} must be a string array`);
  }
}

function assertUrlSafeIdentifierArrayEntries(
  value: readonly string[],
  field: string
): void {
  for (const entry of value) {
    assertUrlSafeIdentifier(entry, field);
  }
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
