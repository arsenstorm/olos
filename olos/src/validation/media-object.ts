import type { MediaObject } from "../types/media-object";
import { assertContentType } from "./content-type";
import {
  assertIsoDateField,
  assertNonEmptyStringField,
  assertOnlyKnownFields,
  assertPositiveIntegerField,
  assertUrlSafeField,
  isRecord,
} from "./fields";
import { assertSafeObjectKey } from "./object-key";

/** Every field the wire-format `MediaObject` observation may carry. */
export const MEDIA_OBJECT_FIELDS = [
  "contentType",
  "etag",
  "objectKey",
  "observedAt",
  "providerId",
  "size",
] as const;

/**
 * Returns whether `value` is a valid `MediaObject` (see
 * `assertMediaObject`).
 */
export function isMediaObject(value: unknown): value is MediaObject {
  try {
    assertMediaObject(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates an untrusted value as a `MediaObject` observation, throwing an
 * `Error` naming the first offending field. Rejects unknown fields and
 * requires a safe object key, a well-formed content type, an ISO 8601
 * `observedAt`, and a positive integer `size`. `allowed` widens the closed
 * field set for callers that layer extra fields on the observation shape
 * (`assertObservedUpload`); wire documents use the default list.
 */
export function assertMediaObject(
  value: unknown,
  allowed: readonly string[] = MEDIA_OBJECT_FIELDS
): asserts value is MediaObject {
  if (!isRecord(value)) {
    throw new Error("mediaObject must be an object");
  }

  assertOnlyKnownFields(value, allowed, "mediaObject");
  assertMediaObjectIdentity(value);
  assertMediaObjectObservation(value);
  assertOptionalMediaObjectFields(value);
}

function assertMediaObjectIdentity(value: Record<string, unknown>): void {
  assertUrlSafeField(value, "providerId", "mediaObject");
  assertSafeObjectKey(value.objectKey, "mediaObject.objectKey");
  assertContentType(value.contentType, "mediaObject.contentType");
}

function assertMediaObjectObservation(value: Record<string, unknown>): void {
  assertIsoDateField(value, "observedAt", "mediaObject");
  assertPositiveIntegerField(value, "size", "mediaObject");
}

function assertOptionalMediaObjectFields(value: Record<string, unknown>): void {
  if (value.etag !== undefined) {
    assertNonEmptyStringField(value, "etag", "mediaObject");
  }
}
