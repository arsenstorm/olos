import type { Byterange } from "../types/byterange";
import { assertSafeDeliveryUrl } from "./delivery-url";
import {
  assertNonNegativeIntegerField,
  assertPositiveIntegerField,
  isRecord,
} from "./fields";
import { assertSafeObjectKey } from "./object-key";

export function isByterange(value: unknown): value is Byterange {
  try {
    assertByterange(value, "byterange");
    return true;
  } catch {
    return false;
  }
}

export function assertByterange(
  value: unknown,
  name: string
): asserts value is Byterange {
  if (!isRecord(value)) {
    throw new Error(`${name} must be an object`);
  }

  assertNonNegativeIntegerField(value, "offset", name);
  assertPositiveIntegerField(value, "length", name);
  assertSafeObjectKey(value.segmentObjectKey, `${name}.segmentObjectKey`);
  assertSafeDeliveryUrl(value.segmentDeliveryUrl, `${name}.segmentDeliveryUrl`);
}

/**
 * When a part's commit/slot carries a `byterange`, the value's `kind` must be
 * `"part"`. Per OLOS, segment and init objects are never expressed as a byte
 * range into a virtual segment.
 */
export function assertByterangeKind(kind: string, name: string): void {
  if (kind !== "part") {
    throw new Error(`${name}.byterange may only be set when kind is "part"`);
  }
}
