import type { MediaObject } from "../types/media-object";
import { assertContentType } from "./content-type";
import {
  assertIsoDateField,
  assertNonEmptyStringField,
  assertPositiveIntegerField,
  assertUrlSafeField,
  isRecord,
} from "./fields";
import { assertSafeObjectKey } from "./object-key";

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
 * `Error` naming the first offending field. Requires a safe object key, a
 * well-formed content type, an ISO 8601 `observedAt`, and a positive
 * integer `size`.
 */
export function assertMediaObject(
  value: unknown
): asserts value is MediaObject {
  if (!isRecord(value)) {
    throw new Error("mediaObject must be an object");
  }

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
