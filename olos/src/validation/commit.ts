import { PUBLICATION_MODES } from "../config/publication";
import type { Commit } from "../types/commit";
import { assertSafeDeliveryUrl } from "./delivery-url";
import { isNonNegativeInteger, isUrlSafeIdentifier } from "./ids";
import { assertSafeObjectKey } from "./object-key";

export function isCommit(value: unknown): value is Commit {
  try {
    assertCommit(value);
    return true;
  } catch {
    return false;
  }
}

export function assertCommit(value: unknown): asserts value is Commit {
  if (!isRecord(value)) {
    throw new Error("commit must be an object");
  }

  assertUrlSafeField(value, "commitId");
  assertUrlSafeField(value, "slotId");
  assertUrlSafeField(value, "sessionId");
  assertUrlSafeField(value, "renditionId");
  assertUrlSafeField(value, "providerId");

  assertNonNegativeIntegerField(value, "epoch");
  assertNonNegativeIntegerField(value, "mediaSequenceNumber");

  if (value.partNumber !== undefined) {
    assertNonNegativeIntegerField(value, "partNumber");
  }

  assertPositiveNumberField(value, "duration");
  assertPositiveNumberField(value, "size");

  assertSafeObjectKey(value.objectKey, "commit.objectKey");
  assertSafeDeliveryUrl(value.deliveryUrl, "commit.deliveryUrl");
  assertTimestampField(value, "committedAt");

  if (value.etag !== undefined) {
    assertStringField(value, "etag");
  }

  if (value.programDateTime !== undefined) {
    assertTimestampField(value, "programDateTime");
  }

  if (
    value.independent !== undefined &&
    typeof value.independent !== "boolean"
  ) {
    throw new Error("commit.independent must be a boolean");
  }

  assertAllowedValue(
    value.publicationMode,
    PUBLICATION_MODES,
    "commit.publicationMode"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertUrlSafeField(
  value: Record<string, unknown>,
  field: string
): void {
  if (!isUrlSafeIdentifier(value[field])) {
    throw new Error(`commit.${field} must be a non-empty URL-safe identifier`);
  }
}

function assertNonNegativeIntegerField(
  value: Record<string, unknown>,
  field: string
): void {
  if (!isNonNegativeInteger(value[field])) {
    throw new Error(`commit.${field} must be a non-negative integer`);
  }
}

function assertPositiveNumberField(
  value: Record<string, unknown>,
  field: string
): void {
  if (
    typeof value[field] !== "number" ||
    !Number.isFinite(value[field]) ||
    value[field] <= 0
  ) {
    throw new Error(`commit.${field} must be a positive number`);
  }
}

function assertTimestampField(
  value: Record<string, unknown>,
  field: string
): void {
  if (
    typeof value[field] !== "string" ||
    Number.isNaN(Date.parse(value[field]))
  ) {
    throw new Error(`commit.${field} must be a valid timestamp`);
  }
}

function assertStringField(
  value: Record<string, unknown>,
  field: string
): void {
  if (typeof value[field] !== "string") {
    throw new Error(`commit.${field} must be a string`);
  }
}

function assertAllowedValue<const Values extends readonly string[]>(
  value: unknown,
  allowedValues: Values,
  name: string
): void {
  if (typeof value !== "string" || !allowedValues.includes(value)) {
    throw new Error(`${name} must be one of: ${allowedValues.join(", ")}`);
  }
}
