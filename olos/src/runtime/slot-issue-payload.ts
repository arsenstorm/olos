import { MEDIA_OBJECT_KINDS } from "../config/media-object";
import type { IssueCoordinatorSlotOptions } from "../protocol";
import type { Byterange } from "../types/byterange";
import type { MediaObjectKind } from "../types/media-object";
import { assertByterange, assertByterangeKind } from "../validation/byterange";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertSupportedMediaExtension } from "../validation/object-key";
import { assertSafePath, assertSafePathSegment } from "./path";
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

export function parseRuntimeSlotIssuePayload(
  value: Record<string, unknown>
): RuntimeSlotIssuePayload {
  assertNoLegacyAddressFields(value);
  const kind = oneOfStringField(value, "kind", MEDIA_OBJECT_KINDS);
  const partNumber = optionalNonNegativeIntegerField(value, "partNumber");
  assertPartNumberKindMatch(kind, partNumber);

  return {
    contentType: stringField(value, "contentType"),
    duration: positiveNumberField(value, "duration"),
    expiresAt: stringField(value, "expiresAt"),
    kind,
    maxBytes: positiveNumberField(value, "maxBytes"),
    mediaSequenceNumber: nonNegativeIntegerField(value, "mediaSequenceNumber"),
    renditionId: urlSafeIdentifierField(value, "renditionId"),
    slotId: urlSafeIdentifierField(value, "slotId"),
    ...optionalNonNegativeIntegerField(value, "minBytes"),
    ...partNumber,
    ...optionalDerivationHints(value, kind),
    ...optionalSlotByterange(value, kind),
  };
}

function assertNoLegacyAddressFields(value: Record<string, unknown>): void {
  if (value.objectKey !== undefined) {
    throw new Error(
      "slot issue payload must not include objectKey (the coordinator derives it)"
    );
  }

  if (value.deliveryUrl !== undefined) {
    throw new Error(
      "slot issue payload must not include deliveryUrl (the coordinator derives it)"
    );
  }
}

function assertPartNumberKindMatch(
  kind: MediaObjectKind,
  partNumber: { partNumber?: number }
): void {
  if (kind === "part" && partNumber.partNumber === undefined) {
    throw new Error('partNumber is required when kind is "part"');
  }

  if (kind !== "part" && partNumber.partNumber !== undefined) {
    throw new Error("partNumber is only valid for parts");
  }
}

function optionalDerivationHints(
  value: Record<string, unknown>,
  kind: MediaObjectKind
): { extension?: string; objectKeyNonce?: string; objectKeyPrefix?: string } {
  const hints: {
    extension?: string;
    objectKeyNonce?: string;
    objectKeyPrefix?: string;
  } = {};

  const extension = optionalStringField(value, "extension").extension;
  if (extension !== undefined) {
    assertSafePathSegment(extension, "extension");
    assertSupportedMediaExtension(extension, kind, "extension");
    hints.extension = extension;
  }

  const nonce = optionalStringField(value, "objectKeyNonce").objectKeyNonce;
  if (nonce !== undefined) {
    assertUrlSafeIdentifier(nonce, "objectKeyNonce");
    hints.objectKeyNonce = nonce;
  }

  const prefix = optionalStringField(value, "objectKeyPrefix").objectKeyPrefix;
  if (prefix !== undefined) {
    assertSafePath(prefix, "objectKeyPrefix");
    hints.objectKeyPrefix = prefix;
  }

  return hints;
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
