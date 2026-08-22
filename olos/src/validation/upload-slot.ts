import { OBJECT_KINDS } from "../types/storage-object";
import type { UploadSlot } from "../types/upload-slot";
import { UPLOAD_SLOT_STATES } from "../types/upload-slot";
import {
  assertByterange,
  assertByterangeKind,
  BYTERANGE_FIELDS,
} from "./byterange";
import { assertContentType } from "./content-type";
import { assertSafeDeliveryUrl } from "./delivery-url";
import {
  assertIsoDateField,
  assertNonNegativeIntegerField,
  assertOneOfField,
  assertOnlyKnownFields,
  assertPositiveIntegerField,
  assertUrlSafeField,
  isRecord,
  type KnownFieldsShape,
  pruneUnknownFields,
} from "./fields";
import { assertSafeObjectKey } from "./object-key";
import { assertOptionalProfileField } from "./profile";

const UPLOAD_SLOT_FIELDS = [
  "byterange",
  "contentType",
  "deliveryUrl",
  "epoch",
  "expiresAt",
  "kind",
  "maxBytes",
  "minBytes",
  "objectKey",
  "partNumber",
  "profile",
  "sequenceNumber",
  "sessionId",
  "slotId",
  "state",
  "trackId",
] as const;

const UPLOAD_SLOT_SHAPE: KnownFieldsShape = {
  fields: UPLOAD_SLOT_FIELDS,
  nested: {
    byterange: { kind: "object", shape: { fields: BYTERANGE_FIELDS } },
  },
};

/**
 * Returns whether `value` is a valid `UploadSlot` (see `assertUploadSlot`).
 */
export function isUploadSlot(value: unknown): value is UploadSlot {
  try {
    assertUploadSlot(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates an untrusted value as an `UploadSlot`, throwing an `Error`
 * naming the first offending field. Rejects unknown fields, unsafe object
 * keys and delivery URLs, `minBytes` above `maxBytes`, and a `byterange` on
 * anything but a part slot. `profile` is only checked to be an object.
 */
export function assertUploadSlot(value: unknown): asserts value is UploadSlot {
  if (!isRecord(value)) {
    throw new Error("uploadSlot must be an object");
  }

  assertOnlyKnownFields(value, UPLOAD_SLOT_FIELDS, "uploadSlot");
  assertUploadSlotIdentifiers(value);
  assertUploadSlotSequenceFields(value);
  assertUploadSlotByteFields(value);
  assertUploadSlotObjectFields(value);
  assertUploadSlotByterange(value);
  assertOptionalProfileField(value, "uploadSlot");
  assertOneOfField(value, "state", UPLOAD_SLOT_STATES, "uploadSlot");
}

/**
 * Tolerant read-path parser for an `UploadSlot` (spec §11.2): unknown
 * fields — including inside `byterange` — are stripped from a fresh copy,
 * which is then validated by the unchanged closed `assertUploadSlot` and
 * returned. Known fields are still rejected when invalid. `profile` is
 * passed through untouched.
 */
export function parseUploadSlot(value: unknown): UploadSlot {
  const pruned = pruneUnknownFields(value, UPLOAD_SLOT_SHAPE);

  assertUploadSlot(pruned);

  return pruned;
}

function assertUploadSlotByterange(value: Record<string, unknown>): void {
  if (value.byterange === undefined) {
    return;
  }

  assertByterange(value.byterange, "uploadSlot.byterange");
  assertByterangeKind(value.kind as string, "uploadSlot");
}

function assertUploadSlotIdentifiers(value: Record<string, unknown>): void {
  assertUrlSafeField(value, "slotId", "uploadSlot");
  assertUrlSafeField(value, "sessionId", "uploadSlot");
  assertUrlSafeField(value, "trackId", "uploadSlot");
}

function assertUploadSlotSequenceFields(value: Record<string, unknown>): void {
  assertNonNegativeIntegerField(value, "epoch", "uploadSlot");
  assertNonNegativeIntegerField(value, "sequenceNumber", "uploadSlot");

  if (value.partNumber !== undefined) {
    assertNonNegativeIntegerField(value, "partNumber", "uploadSlot");
  }
}

function assertUploadSlotByteFields(value: Record<string, unknown>): void {
  assertPositiveIntegerField(value, "maxBytes", "uploadSlot");
  assertIsoDateField(value, "expiresAt", "uploadSlot");
  if (value.minBytes !== undefined) {
    assertNonNegativeIntegerField(value, "minBytes", "uploadSlot");
    assertUploadSlotMinBytesWithinMaxBytes(value);
  }
}

function assertUploadSlotMinBytesWithinMaxBytes(
  value: Record<string, unknown>
): void {
  if (Number(value.minBytes) > Number(value.maxBytes)) {
    throw new Error(
      "uploadSlot.minBytes must be less than or equal to maxBytes"
    );
  }
}

function assertUploadSlotObjectFields(value: Record<string, unknown>): void {
  assertOneOfField(value, "kind", OBJECT_KINDS, "uploadSlot");
  assertSafeObjectKey(value.objectKey, "uploadSlot.objectKey");
  assertSafeDeliveryUrl(value.deliveryUrl, "uploadSlot.deliveryUrl");
  assertContentType(value.contentType, "uploadSlot.contentType");
}
