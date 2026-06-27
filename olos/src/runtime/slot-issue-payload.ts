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
  for (const field of ["objectKey", "deliveryUrl"] as const) {
    if (value[field] !== undefined) {
      throw new Error(
        `slot issue payload must not include ${field} (the coordinator derives it)`
      );
    }
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
  return {
    ...checkedOptionalString(value, "extension", (v, name) => {
      assertSafePathSegment(v, name);
      assertSupportedMediaExtension(v, kind, name);
    }),
    ...checkedOptionalString(value, "objectKeyNonce", assertUrlSafeIdentifier),
    ...checkedOptionalString(value, "objectKeyPrefix", assertSafePath),
  };
}

function checkedOptionalString<Field extends string>(
  value: Record<string, unknown>,
  field: Field,
  check: (v: string, name: string) => void
): { [K in Field]?: string } {
  const parsed = optionalStringField(value, field);
  const v = parsed[field];
  if (v !== undefined) {
    check(v, field);
  }
  return parsed;
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
