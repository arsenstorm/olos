import { MEDIA_OBJECT_KINDS } from "../config/media-object";
import type { IssueCoordinatorSlotOptions } from "../protocol";
import type { Byterange } from "../types/byterange";
import type { MediaObjectKind } from "../types/media-object";
import { assertByterange, assertByterangeKind } from "../validation/byterange";
import { assertSafeDeliveryUrl } from "../validation/delivery-url";
import { assertSafeMediaObjectKey } from "../validation/object-key";
import {
  nonNegativeIntegerField,
  oneOfStringField,
  optionalNonNegativeIntegerField,
  optionalStringField,
  positiveNumberField,
  stringField,
  urlSafeIdentifierField,
} from "./request-fields";

export interface RuntimeSlotIssuePayload
  extends Omit<IssueCoordinatorSlotOptions, "state"> {}

interface RuntimeSlotIssueObjectFields {
  deliveryUrl?: string;
  objectKey?: string;
}

export function parseRuntimeSlotIssuePayload(
  value: Record<string, unknown>
): RuntimeSlotIssuePayload {
  const kind = oneOfStringField(value, "kind", MEDIA_OBJECT_KINDS);
  const objectFields = runtimeSlotIssueObjectFields(value, kind);

  return {
    contentType: stringField(value, "contentType"),
    duration: positiveNumberField(value, "duration"),
    expiresAt: stringField(value, "expiresAt"),
    kind,
    maxBytes: positiveNumberField(value, "maxBytes"),
    mediaSequenceNumber: nonNegativeIntegerField(value, "mediaSequenceNumber"),
    renditionId: urlSafeIdentifierField(value, "renditionId"),
    slotId: urlSafeIdentifierField(value, "slotId"),
    ...objectFields,
    ...optionalNonNegativeIntegerField(value, "minBytes"),
    ...optionalNonNegativeIntegerField(value, "partNumber"),
    ...optionalStringField(value, "extension"),
    ...optionalStringField(value, "objectKeyNonce"),
    ...optionalStringField(value, "objectKeyPrefix"),
    ...optionalSlotByterange(value, kind),
  };
}

function runtimeSlotIssueObjectFields(
  value: Record<string, unknown>,
  kind: MediaObjectKind
): RuntimeSlotIssueObjectFields {
  const fields: RuntimeSlotIssueObjectFields = {};

  if (value.deliveryUrl !== undefined) {
    const deliveryUrl = stringField(value, "deliveryUrl");
    assertSafeDeliveryUrl(deliveryUrl, "deliveryUrl");
    fields.deliveryUrl = deliveryUrl;
  }

  if (value.objectKey !== undefined) {
    const objectKey = stringField(value, "objectKey");
    assertSafeMediaObjectKey(objectKey, kind, "objectKey");
    fields.objectKey = objectKey;
  }

  return fields;
}

function optionalSlotByterange(
  value: Record<string, unknown>,
  kind: string
): { byterange?: Byterange } {
  if (value.byterange === undefined) {
    return {};
  }

  assertByterange(value.byterange, "byterange");
  assertByterangeKind(kind, "uploadSlot");

  return { byterange: value.byterange };
}
