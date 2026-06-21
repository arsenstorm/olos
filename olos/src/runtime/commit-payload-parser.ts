import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertSafeObjectKey } from "../validation/object-key";
import { optionalField } from "./optional-field";
import {
  optionalBooleanField,
  optionalNonNegativeNumberField,
  optionalPositiveIntegerField,
  optionalTimestampField,
  optionalTimestampValueField,
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
