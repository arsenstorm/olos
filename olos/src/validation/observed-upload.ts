import type { MediaObject } from "../types/media-object";
import type { UploadSlot } from "../types/upload-slot";
import { nonNegativeNumber } from "./fields";
import { isOptionalHttpHeaderStringMap } from "./http-header";
import { assertMediaObject } from "./media-object";
import { assertUploadSlot } from "./upload-slot";

export interface ObservedUpload extends MediaObject {
  metadata?: Record<string, string | undefined>;
}

export interface ObservedUploadMatchOptions {
  lateToleranceMs?: number;
  object: ObservedUpload;
  slot: UploadSlot;
}

type ObservableUploadSlot = UploadSlot & {
  state: "issued" | "upload_observed";
};

export function isObservedUpload(value: unknown): value is ObservedUpload {
  try {
    assertObservedUpload(value);
    return true;
  } catch {
    return false;
  }
}

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

export function assertObservedUploadMatchesSlot(
  options: ObservedUploadMatchOptions
): void {
  assertUploadSlot(options.slot);
  assertObservedUpload(options.object);
  assertObservableSlotState(options.slot);
  assertObjectMatchesSlot(options);
}

export function assertObservedUpload(
  value: unknown
): asserts value is ObservedUpload {
  assertMediaObject(value);
  assertOptionalObservedUploadMetadata(value);
}

function assertOptionalObservedUploadMetadata(value: MediaObject): void {
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

  if (object.size > slot.maxBytes) {
    throw new Error(
      "observedUpload.size must be less than or equal to uploadSlot.maxBytes"
    );
  }

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

  const lateToleranceMs = nonNegativeNumber(
    options.lateToleranceMs ?? 0,
    "lateToleranceMs"
  );

  if (
    Date.parse(object.observedAt) >
    Date.parse(slot.expiresAt) + lateToleranceMs
  ) {
    throw new Error(
      "observedUpload.observedAt must be before or equal to uploadSlot.expiresAt"
    );
  }
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
