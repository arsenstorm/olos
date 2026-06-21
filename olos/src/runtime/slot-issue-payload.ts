import { MEDIA_OBJECT_KINDS } from "../config/media-object";
import { PUBLICATION_MODES } from "../config/publication";
import type { IssueCoordinatorSlotOptions } from "../protocol";
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

export function parseRuntimeSlotIssuePayload(
  value: Record<string, unknown>
): RuntimeSlotIssuePayload {
  const kind = oneOfStringField(value, "kind", MEDIA_OBJECT_KINDS);
  const deliveryUrl = stringField(value, "deliveryUrl");
  const objectKey = stringField(value, "objectKey");

  assertSafeDeliveryUrl(deliveryUrl, "deliveryUrl");
  assertSafeMediaObjectKey(objectKey, kind, "objectKey");

  return {
    contentType: stringField(value, "contentType"),
    deliveryUrl,
    duration: positiveNumberField(value, "duration"),
    expiresAt: stringField(value, "expiresAt"),
    kind,
    maxBytes: positiveNumberField(value, "maxBytes"),
    mediaSequenceNumber: nonNegativeIntegerField(value, "mediaSequenceNumber"),
    objectKey,
    publicationMode: oneOfStringField(
      value,
      "publicationMode",
      PUBLICATION_MODES
    ),
    publisherInstanceId: urlSafeIdentifierField(value, "publisherInstanceId"),
    renditionId: urlSafeIdentifierField(value, "renditionId"),
    slotId: urlSafeIdentifierField(value, "slotId"),
    ...optionalNonNegativeIntegerField(value, "minBytes"),
    ...optionalNonNegativeIntegerField(value, "partNumber"),
  };
}
