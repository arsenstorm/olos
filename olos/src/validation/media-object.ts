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
  assertPositiveNumberField(value, "size", "mediaObject");
}

function assertOptionalMediaObjectFields(value: Record<string, unknown>): void {
  assertOptionalNonEmptyStringField(value, "etag", "mediaObject");
}

function assertOptionalNonEmptyStringField(
  value: Record<string, unknown>,
  field: string,
  name: string
): void {
  if (value[field] !== undefined) {
    assertNonEmptyStringField(value, field, name);
  }
}
