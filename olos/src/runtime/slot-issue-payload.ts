import { MEDIA_OBJECT_KINDS } from "../config/media-object";
import type { IssueCoordinatorSlotOptions } from "../protocol";
import type { Byterange } from "../types/byterange";
import { assertByterange, assertByterangeKind } from "../validation/byterange";
import { assertSafeDeliveryUrl } from "../validation/delivery-url";
import { assertSafeMediaObjectKey } from "../validation/object-key";
import {
  nonNegativeIntegerField,
  oneOfStringField,
  optionalNonNegativeIntegerField,
  positiveNumberField,
  stringField,
  urlSafeIdentifierField,
} from "./request-fields";

export interface RuntimeSlotIssuePayload
  extends Omit<IssueCoordinatorSlotOptions, "state"> {}

type RuntimeSlotIssueObjectFields = Pick<RuntimeSlotIssuePayload, "kind"> & {
  deliveryUrl?: string;
  objectKey?: string;
};

export function parseRuntimeSlotIssuePayload(
  value: Record<string, unknown>
): RuntimeSlotIssuePayload {
  const object = runtimeSlotIssueObjectFields(value);

  return {
    contentType: stringField(value, "contentType"),
    duration: positiveNumberField(value, "duration"),
    expiresAt: stringField(value, "expiresAt"),
    maxBytes: positiveNumberField(value, "maxBytes"),
    mediaSequenceNumber: nonNegativeIntegerField(value, "mediaSequenceNumber"),
    renditionId: urlSafeIdentifierField(value, "renditionId"),
    slotId: urlSafeIdentifierField(value, "slotId"),
    ...object,
    ...optionalNonNegativeIntegerField(value, "minBytes"),
    ...optionalNonNegativeIntegerField(value, "partNumber"),
    ...optionalSlotByterange(value, object.kind),
  };
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

function runtimeSlotIssueObjectFields(
  value: Record<string, unknown>
): RuntimeSlotIssueObjectFields {
  const kind = oneOfStringField(value, "kind", MEDIA_OBJECT_KINDS);
  const fields: RuntimeSlotIssueObjectFields = { kind };

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
