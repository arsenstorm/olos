import type { IssueCoordinatorSlotOptions } from "../protocol/coordinator-types";
import type { Byterange } from "../types/byterange";
import type { ObjectKind } from "../types/storage-object";
import { OBJECT_KINDS } from "../types/storage-object";
import { assertByterange, assertByterangeKind } from "../validation/byterange";
import { isRecord } from "../validation/fields";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertSafePath, assertSafePathSegment } from "./path";
import {
  nonNegativeIntegerField,
  oneOfStringField,
  optionalNonNegativeIntegerField,
  optionalProfileField,
  optionalStringField,
  positiveNumberField,
  stringField,
  urlSafeIdentifierField,
} from "./request-fields";
import {
  parseRuntimeJsonRequest,
  type RuntimeJsonRequestInvalidBuilder,
  type RuntimeJsonRequestParse,
} from "./request-json";

/**
 * Wire payload for requesting an upload slot: the planned object's
 * identity, timeline position, byte bounds, and expiry, plus optional
 * opaque `profile` data and object key derivation hints. It must not carry
 * `objectKey` or `deliveryUrl` — the coordinator derives those at issuance.
 */
export interface RuntimeSlotIssuePayload
  extends Omit<IssueCoordinatorSlotOptions, "state"> {}

export type SlotIssueRequestParse<Invalid> = RuntimeJsonRequestParse<
  RuntimeSlotIssuePayload,
  Invalid
>;

export function parseSlotIssueRequest<Invalid>(
  request: Request | RuntimeSlotIssuePayload,
  invalid: RuntimeJsonRequestInvalidBuilder<Invalid>,
  fallbackMessage: string,
  payloadName = "slot issue request",
  maxBodyBytes?: number
): Promise<SlotIssueRequestParse<Invalid>> {
  return parseRuntimeJsonRequest(
    request,
    (value) => parsePayload(value, payloadName),
    invalid,
    fallbackMessage,
    maxBodyBytes
  );
}

function parsePayload(
  value: unknown,
  payloadName: string
): RuntimeSlotIssuePayload {
  if (!isRecord(value)) {
    throw new Error(`${payloadName} must be a JSON object`);
  }

  return parseRuntimeSlotIssuePayload(value);
}

export function parseRuntimeSlotIssuePayload(
  value: Record<string, unknown>
): RuntimeSlotIssuePayload {
  assertNoLegacyAddressFields(value);
  const kind = oneOfStringField(value, "kind", OBJECT_KINDS);
  const partNumber = optionalNonNegativeIntegerField(value, "partNumber");
  assertPartNumberKindMatch(kind, partNumber.partNumber);

  return {
    contentType: stringField(value, "contentType"),
    expiresAt: stringField(value, "expiresAt"),
    kind,
    maxBytes: positiveNumberField(value, "maxBytes"),
    sequenceNumber: nonNegativeIntegerField(value, "sequenceNumber"),
    slotId: urlSafeIdentifierField(value, "slotId"),
    trackId: urlSafeIdentifierField(value, "trackId"),
    ...optionalNonNegativeIntegerField(value, "minBytes"),
    ...partNumber,
    ...optionalProfileField(value),
    ...optionalDerivationHints(value),
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
  kind: ObjectKind,
  partNumber: number | undefined
): void {
  if (kind === "part" && partNumber === undefined) {
    throw new Error('partNumber is required when kind is "part"');
  }

  if (kind !== "part" && partNumber !== undefined) {
    throw new Error("partNumber is only valid for parts");
  }
}

function optionalDerivationHints(value: Record<string, unknown>): {
  extension?: string;
  objectKeyNonce?: string;
  objectKeyPrefix?: string;
} {
  return {
    ...checkedOptionalString(value, "extension", assertSafePathSegment),
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
