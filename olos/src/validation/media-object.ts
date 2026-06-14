import type { MediaObject } from "../types/media-object";
import { assertContentType } from "./content-type";
import { isUrlSafeIdentifier } from "./ids";
import { assertSafeObjectKey } from "./object-key";

export function isMediaObject(value: unknown): value is MediaObject {
  try {
    assertMediaObject(value);
    return true;
  } catch {
    return false;
  }
}

export function assertMediaObject(
  value: unknown
): asserts value is MediaObject {
  if (!isRecord(value)) {
    throw new Error("mediaObject must be an object");
  }

  if (!isUrlSafeIdentifier(value.providerId)) {
    throw new Error(
      "mediaObject.providerId must be a non-empty URL-safe identifier"
    );
  }

  assertSafeObjectKey(value.objectKey, "mediaObject.objectKey");
  assertContentType(value.contentType, "mediaObject.contentType");
  assertIsoDateField(value, "observedAt");
  assertPositiveNumberField(value, "size");

  if (value.etag !== undefined) {
    assertNonEmptyStringField(value, "etag");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNonEmptyStringField(
  value: Record<string, unknown>,
  field: string
): void {
  if (typeof value[field] !== "string" || value[field].length === 0) {
    throw new Error(`mediaObject.${field} must be a non-empty string`);
  }
}

function assertIsoDateField(
  value: Record<string, unknown>,
  field: string
): void {
  if (
    typeof value[field] !== "string" ||
    Number.isNaN(Date.parse(value[field]))
  ) {
    throw new Error(`mediaObject.${field} must be a valid timestamp`);
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
    throw new Error(`mediaObject.${field} must be a positive number`);
  }
}
