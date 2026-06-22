import { MEDIA_OBJECT_KINDS } from "../config/media-object";
import { PUBLICATION_MODES } from "../config/publication";
import { UPLOAD_SLOT_STATES } from "../config/upload-slot";
import type { UploadSlot } from "../types/upload-slot";
import { assertContentType } from "./content-type";
import { assertSafeDeliveryUrl } from "./delivery-url";
import {
  assertIsoDateField,
  assertNonNegativeIntegerField,
  assertOneOfField,
  assertPositiveNumberField,
  assertUrlSafeField,
  isRecord,
} from "./fields";
import { assertSafeMediaObjectKey } from "./object-key";

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

  assertUploadSlotIdentifiers(value);
  assertUploadSlotSequenceFields(value);
  assertUploadSlotByteFields(value);
  assertUploadSlotMediaFields(value);
  assertOneOfField(value, "publicationMode", PUBLICATION_MODES, "uploadSlot");
  assertOneOfField(value, "state", UPLOAD_SLOT_STATES, "uploadSlot");
}

function assertUploadSlotIdentifiers(value: Record<string, unknown>): void {
  assertUrlSafeField(value, "slotId", "uploadSlot");
  assertUrlSafeField(value, "sessionId", "uploadSlot");
  assertUrlSafeField(value, "tenantId", "uploadSlot");
  assertUrlSafeField(value, "publisherInstanceId", "uploadSlot");
  assertUrlSafeField(value, "renditionId", "uploadSlot");
}

function assertUploadSlotSequenceFields(value: Record<string, unknown>): void {
  assertNonNegativeIntegerField(value, "epoch", "uploadSlot");
  assertNonNegativeIntegerField(value, "mediaSequenceNumber", "uploadSlot");

  if (value.partNumber !== undefined) {
    assertNonNegativeIntegerField(value, "partNumber", "uploadSlot");
  }
}

function assertUploadSlotByteFields(value: Record<string, unknown>): void {
  assertPositiveNumberField(value, "duration", "uploadSlot");
  assertPositiveNumberField(value, "maxBytes", "uploadSlot");
  assertIsoDateField(value, "expiresAt", "uploadSlot");

  if (value.minBytes !== undefined) {
    assertNonNegativeIntegerField(value, "minBytes", "uploadSlot");

    if (Number(value.minBytes) > Number(value.maxBytes)) {
      throw new Error(
        "uploadSlot.minBytes must be less than or equal to maxBytes"
      );
    }
  }
}

function assertUploadSlotMediaFields(value: Record<string, unknown>): void {
  const kind = assertOneOfField(
    value,
    "kind",
    MEDIA_OBJECT_KINDS,
    "uploadSlot"
  );
  assertSafeMediaObjectKey(value.objectKey, kind, "uploadSlot.objectKey");
  assertSafeDeliveryUrl(value.deliveryUrl, "uploadSlot.deliveryUrl");
  assertContentType(value.contentType, "uploadSlot.contentType");
}
