import type { StorageObject } from "../types/storage-object";
import type { UploadSlot } from "../types/upload-slot";
import { nonNegativeNumber } from "./fields";
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

type ObservableUploadSlot = UploadSlot & {
  state: "issued" | "upload_observed";
};

/**
 * Returns whether `value` is a valid `ObservedUpload` (see
 * `assertObservedUpload`).
 */
export function isObservedUpload(value: unknown): value is ObservedUpload {
  try {
    assertObservedUpload(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns whether the observed upload satisfies its slot (see
 * `assertObservedUploadMatchesSlot`).
 */
export function observedUploadMatchesSlot(
  options: ObservedUploadMatchOptions
): boolean {
  try {
    assertObservedUploadMatchesSlot(options);
    return true;
  } catch {
    return false;
  }
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

function isObservableUploadSlot(
  slot: UploadSlot
): slot is ObservableUploadSlot {
  return slot.state === "issued" || slot.state === "upload_observed";
}

function assertObjectMatchesSlot(options: ObservedUploadMatchOptions): void {
  assertObjectIdentityMatchesSlot(options);
  assertObjectSizeWithinSlot(options);
  assertObservationBeforeSlotExpiry(options);
  assertObservedSlotMetadataMatchesSlot(options);
}

function assertObjectIdentityMatchesSlot(
  options: ObservedUploadMatchOptions
): void {
  const { object, slot } = options;

  if (object.objectKey !== slot.objectKey) {
    throw new Error("observedUpload.objectKey must match uploadSlot.objectKey");
  }

  if (object.contentType !== slot.contentType) {
    throw new Error(
      "observedUpload.contentType must match uploadSlot.contentType"
    );
  }
}

function assertObjectSizeWithinSlot(options: ObservedUploadMatchOptions): void {
  const { object, slot } = options;

  assertObjectSizeDoesNotExceedSlotMax(object, slot);
  assertObjectSizeMeetsSlotMin(object, slot);
}

function assertObjectSizeDoesNotExceedSlotMax(
  object: ObservedUpload,
  slot: UploadSlot
): void {
  if (object.size > slot.maxBytes) {
    throw new Error(
      "observedUpload.size must be less than or equal to uploadSlot.maxBytes"
    );
  }
}

function assertObjectSizeMeetsSlotMin(
  object: ObservedUpload,
  slot: UploadSlot
): void {
  if (slot.minBytes !== undefined && object.size < slot.minBytes) {
    throw new Error(
      "observedUpload.size must be greater than or equal to uploadSlot.minBytes"
    );
  }
}

function assertObservationBeforeSlotExpiry(
  options: ObservedUploadMatchOptions
): void {
  const { object, slot } = options;

  if (Date.parse(object.observedAt) > toleratedSlotExpiryMs(slot, options)) {
    throw new Error(
      "observedUpload.observedAt must be before or equal to uploadSlot.expiresAt"
    );
  }
}

function toleratedSlotExpiryMs(
  slot: UploadSlot,
  options: ObservedUploadMatchOptions
): number {
  const lateToleranceMs = nonNegativeNumber(
    options.lateToleranceMs ?? 0,
    "lateToleranceMs"
  );

  return Date.parse(slot.expiresAt) + lateToleranceMs;
}

function assertObservedSlotMetadataMatchesSlot(
  options: ObservedUploadMatchOptions
): void {
  const { object, slot } = options;

  const observedSlotId = object.metadata?.["x-olos-slot-id"];

  if (observedSlotId !== undefined && observedSlotId !== slot.slotId) {
    throw new Error(
      "observedUpload.metadata.x-olos-slot-id must match uploadSlot.slotId"
    );
  }
}
