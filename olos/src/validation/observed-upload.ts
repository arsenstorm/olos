import type { StorageObject } from "../types/storage-object";
import type { UploadSlot } from "../types/upload-slot";
import { nonNegativeNumber, passes, timestampMs } from "./fields";
import { isOptionalHttpHeaderStringMap } from "./http-header";
import { assertStorageObject, MEDIA_OBJECT_FIELDS } from "./storage-object";
import { assertUploadSlot } from "./upload-slot";

const OBSERVED_UPLOAD_FIELDS = [...MEDIA_OBJECT_FIELDS, "metadata"] as const;

/**
 * A provider observation of an uploaded object, optionally carrying the
 * upload's metadata headers (e.g. `x-olos-slot-id`) for slot
 * cross-checking.
 */
export interface ObservedUpload extends StorageObject {
  metadata?: Record<string, string | undefined>;
}

/** Options for matching an observed upload against its issued slot. */
export interface ObservedUploadMatchOptions {
  /**
   * Grace period in milliseconds added to the slot's `expiresAt` before an
   * observation counts as late. Defaults to 0.
   */
  lateToleranceMs?: number;
  object: ObservedUpload;
  slot: UploadSlot;
}

export type ObservableUploadSlot = UploadSlot & {
  state: "issued" | "upload_observed";
};

/** The rule an object breaks against its slot. */
export type ObjectSlotMismatch =
  | "contentType"
  | "maxBytes"
  | "minBytes"
  | "objectKey";

const OBSERVED_UPLOAD_MISMATCH_MESSAGES: Readonly<
  Record<ObjectSlotMismatch, string>
> = {
  contentType: "observedUpload.contentType must match uploadSlot.contentType",
  maxBytes:
    "observedUpload.size must be less than or equal to uploadSlot.maxBytes",
  minBytes:
    "observedUpload.size must be greater than or equal to uploadSlot.minBytes",
  objectKey: "observedUpload.objectKey must match uploadSlot.objectKey",
};

/** First rule the object breaks against its slot, or `undefined` when it matches. */
export function objectSlotMismatch(
  object: StorageObject,
  slot: UploadSlot,
  options: { includeKeyMismatch: boolean }
): ObjectSlotMismatch | undefined {
  if (options.includeKeyMismatch && object.objectKey !== slot.objectKey) {
    return "objectKey";
  }

  if (object.contentType !== slot.contentType) {
    return "contentType";
  }

  if (object.size > slot.maxBytes) {
    return "maxBytes";
  }

  if (slot.minBytes !== undefined && object.size < slot.minBytes) {
    return "minBytes";
  }
}

/** Whether `timestamp` falls after the slot's expiry plus the tolerance. */
export function isAfterSlotExpiry(
  timestamp: string,
  slot: UploadSlot,
  lateToleranceMs: number | undefined,
  timestampName: string
): boolean {
  const tolerance = nonNegativeNumber(lateToleranceMs ?? 0, "lateToleranceMs");

  return (
    timestampMs(timestamp, timestampName) >
    timestampMs(slot.expiresAt, "uploadSlot.expiresAt") + tolerance
  );
}

/**
 * The `x-olos-slot-id` the upload's metadata carries when it names a slot
 * other than `slot`, or `undefined` when it matches or is absent.
 */
export function observedSlotIdMismatch(
  object: ObservedUpload,
  slot: UploadSlot
): string | undefined {
  const observedSlotId = object.metadata?.["x-olos-slot-id"];

  return observedSlotId === undefined || observedSlotId === slot.slotId
    ? undefined
    : observedSlotId;
}

/**
 * Returns whether `value` is a valid `ObservedUpload` (see
 * `assertObservedUpload`).
 */
export function isObservedUpload(value: unknown): value is ObservedUpload {
  return passes(assertObservedUpload, value);
}

/**
 * Returns whether the observed upload satisfies its slot (see
 * `assertObservedUploadMatchesSlot`).
 */
export function observedUploadMatchesSlot(
  options: ObservedUploadMatchOptions
): boolean {
  return passes(
    (value) =>
      assertObservedUploadMatchesSlot(value as ObservedUploadMatchOptions),
    options
  );
}

/**
 * The commit-gate check: throws an `Error` unless the observed upload is
 * acceptable evidence for the slot. The slot must be in `issued` or
 * `upload_observed` state, and the object must match the slot's key and
 * content type, fit within its size bounds, be observed no later than
 * `expiresAt` plus `lateToleranceMs`, and — when the upload carries an
 * `x-olos-slot-id` metadata header — name the same slot.
 */
export function assertObservedUploadMatchesSlot(
  options: ObservedUploadMatchOptions
): void {
  assertUploadSlot(options.slot);
  assertObservedUpload(options.object);
  assertObservableSlotState(options.slot);
  assertObjectMatchesSlot(options);
}

/**
 * Validates an untrusted value as an `ObservedUpload`: a valid
 * `StorageObject` whose optional `metadata` is a string map. Throws an
 * `Error` naming the first offending field.
 */
export function assertObservedUpload(
  value: unknown
): asserts value is ObservedUpload {
  assertStorageObject(value, OBSERVED_UPLOAD_FIELDS);
  assertOptionalObservedUploadMetadata(value);
}

function assertOptionalObservedUploadMetadata(value: StorageObject): void {
  if (
    "metadata" in value &&
    value.metadata !== undefined &&
    !isOptionalHttpHeaderStringMap(value.metadata)
  ) {
    throw new Error("observedUpload.metadata must be a string map");
  }
}

function assertObservableSlotState(slot: UploadSlot): void {
  if (!isObservableUploadSlot(slot)) {
    throw new Error("uploadSlot.state must be issued or upload_observed");
  }
}

export function isObservableUploadSlot(
  slot: UploadSlot
): slot is ObservableUploadSlot {
  return slot.state === "issued" || slot.state === "upload_observed";
}

function assertObjectMatchesSlot(options: ObservedUploadMatchOptions): void {
  assertObjectMatchesSlotRules(options);
  assertObservationBeforeSlotExpiry(options);
  assertObservedSlotMetadataMatchesSlot(options);
}

function assertObjectMatchesSlotRules(
  options: ObservedUploadMatchOptions
): void {
  const mismatch = objectSlotMismatch(options.object, options.slot, {
    includeKeyMismatch: true,
  });

  if (mismatch !== undefined) {
    throw new Error(OBSERVED_UPLOAD_MISMATCH_MESSAGES[mismatch]);
  }
}

function assertObservationBeforeSlotExpiry(
  options: ObservedUploadMatchOptions
): void {
  if (
    isAfterSlotExpiry(
      options.object.observedAt,
      options.slot,
      options.lateToleranceMs,
      "observedUpload.observedAt"
    )
  ) {
    throw new Error(
      "observedUpload.observedAt must be before or equal to uploadSlot.expiresAt"
    );
  }
}

function assertObservedSlotMetadataMatchesSlot(
  options: ObservedUploadMatchOptions
): void {
  if (observedSlotIdMismatch(options.object, options.slot) !== undefined) {
    throw new Error(
      "observedUpload.metadata.x-olos-slot-id must match uploadSlot.slotId"
    );
  }
}
