import { MEDIA_OBJECT_KINDS } from "../config/media-object";
import { PUBLICATION_MODES } from "../config/publication";
import { UPLOAD_SLOT_STATES } from "../config/upload-slot";
import type { UploadSlot } from "../types/upload-slot";
import { isNonNegativeInteger, isUrlSafeIdentifier } from "./ids";
import { assertSafeObjectKey } from "./object-key";

export function isUploadSlot(value: unknown): value is UploadSlot {
  try {
    assertUploadSlot(value);
    return true;
  } catch {
    return false;
  }
}

export function assertUploadSlot(value: unknown): asserts value is UploadSlot {
  if (!isRecord(value)) {
    throw new Error("uploadSlot must be an object");
  }

  assertUrlSafeField(value, "slotId");
  assertUrlSafeField(value, "sessionId");
  assertUrlSafeField(value, "tenantId");
  assertUrlSafeField(value, "publisherInstanceId");
  assertUrlSafeField(value, "renditionId");

  assertNonNegativeIntegerField(value, "epoch");
  assertNonNegativeIntegerField(value, "mediaSequenceNumber");

  if (value.partNumber !== undefined) {
    assertNonNegativeIntegerField(value, "partNumber");
  }

  assertPositiveNumberField(value, "duration");
  assertPositiveNumberField(value, "maxBytes");

  if (value.minBytes !== undefined) {
    assertNonNegativeIntegerField(value, "minBytes");

    if (Number(value.minBytes) > Number(value.maxBytes)) {
      throw new Error(
        "uploadSlot.minBytes must be less than or equal to maxBytes"
      );
    }
  }

  assertSafeObjectKey(value.objectKey, "uploadSlot.objectKey");
  assertNonEmptyStringField(value, "deliveryUrl");
  assertNonEmptyStringField(value, "contentType");

  assertAllowedValue(value.kind, MEDIA_OBJECT_KINDS, "uploadSlot.kind");
  assertAllowedValue(
    value.publicationMode,
    PUBLICATION_MODES,
    "uploadSlot.publicationMode"
  );
  assertAllowedValue(value.state, UPLOAD_SLOT_STATES, "uploadSlot.state");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertUrlSafeField(
  value: Record<string, unknown>,
  field: string
): void {
  if (!isUrlSafeIdentifier(value[field])) {
    throw new Error(
      `uploadSlot.${field} must be a non-empty URL-safe identifier`
    );
  }
}

function assertNonNegativeIntegerField(
  value: Record<string, unknown>,
  field: string
): void {
  if (!isNonNegativeInteger(value[field])) {
    throw new Error(`uploadSlot.${field} must be a non-negative integer`);
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
    throw new Error(`uploadSlot.${field} must be a positive number`);
  }
}

function assertNonEmptyStringField(
  value: Record<string, unknown>,
  field: string
): void {
  if (typeof value[field] !== "string" || value[field].length === 0) {
    throw new Error(`uploadSlot.${field} must be a non-empty string`);
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
