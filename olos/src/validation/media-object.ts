import type { MediaObject } from "../types/media-object";
import { assertContentType } from "./content-type";
import {
  assertIsoDateField,
  assertNonEmptyStringField,
  assertPositiveNumberField,
  assertUrlSafeField,
  isRecord,
} from "./fields";
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

  assertUrlSafeField(value, "providerId", "mediaObject");
  assertSafeObjectKey(value.objectKey, "mediaObject.objectKey");
  assertContentType(value.contentType, "mediaObject.contentType");
  assertIsoDateField(value, "observedAt", "mediaObject");
  assertPositiveNumberField(value, "size", "mediaObject");

  if (value.etag !== undefined) {
    assertNonEmptyStringField(value, "etag", "mediaObject");
  }
}
