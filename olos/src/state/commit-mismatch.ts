import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import { createOlosError } from "../types/errors";
import type { StorageObject } from "../types/storage-object";
import type { UploadSlot } from "../types/upload-slot";
import { assertCommit } from "../validation/commit";
import { nonNegativeNumber, timestampMs } from "../validation/fields";
import type {
  CreateCommitOptions,
  DuplicateCommitResolution,
  ObjectSlotMismatchResolution,
  ObservedUploadSlot,
  ResolveDuplicateCommitOptions,
  ResolveObjectSlotMismatchOptions,
} from "./commit-types";
import { trackWindowBounds } from "./committed-window";
import { sameProfileData } from "./profile-data";

export function resolveObjectSlotMismatch(
  options: ResolveObjectSlotMismatchOptions
): ObjectSlotMismatchResolution | undefined {
  if (
    options.includeKeyMismatch === true &&
    options.mediaObject.objectKey !== options.slot.objectKey
  ) {
    return keyMismatch(options);
  }

  if (options.mediaObject.contentType !== options.slot.contentType) {
    return contentTypeMismatch(options);
  }

  if (options.mediaObject.size > options.slot.maxBytes) {
    return objectTooLarge(options);
  }

  if (
    options.slot.minBytes !== undefined &&
    options.mediaObject.size < options.slot.minBytes
  ) {
    return objectTooSmall(options);
  }
}

function keyMismatch(
  options: ResolveObjectSlotMismatchOptions
): ObjectSlotMismatchResolution {
  return {
    error: createOlosError(
      "olos.key_mismatch",
      "object key does not match slot",
      {
        objectKey: options.mediaObject.objectKey,
        slotId: options.slot.slotId,
        slotObjectKey: options.slot.objectKey,
      }
    ),
    status: "key_mismatch",
  };
}

function contentTypeMismatch(
  options: ResolveObjectSlotMismatchOptions
): ObjectSlotMismatchResolution {
  return {
    error: createOlosError(
      "olos.content_type_mismatch",
      "object content type does not match slot",
      {
        contentType: options.mediaObject.contentType,
        objectKey: options.mediaObject.objectKey,
        slotContentType: options.slot.contentType,
        slotId: options.slot.slotId,
      }
    ),
    status: "content_type_mismatch",
  };
}

function objectTooLarge(
  options: ResolveObjectSlotMismatchOptions
): ObjectSlotMismatchResolution {
  return {
    error: createOlosError(
      "olos.object_too_large",
      "object exceeds slot limit",
      {
        maxBytes: options.slot.maxBytes,
        objectKey: options.mediaObject.objectKey,
        size: options.mediaObject.size,
        slotId: options.slot.slotId,
      }
    ),
    status: "object_too_large",
  };
}

function objectTooSmall(
  options: ResolveObjectSlotMismatchOptions
): ObjectSlotMismatchResolution {
  return {
    error: createOlosError(
      "olos.object_too_small",
      "mediaObject.size must be at least minBytes",
      {
        minBytes: options.slot.minBytes,
        objectKey: options.mediaObject.objectKey,
        size: options.mediaObject.size,
        slotId: options.slot.slotId,
      }
    ),
    status: "object_too_small",
  };
}

/**
 * Decide whether a repeated commit for the same slot is a benign retry or
 * a conflict. The duplicate is `idempotent` — the existing commit is
 * returned unchanged — only when every content field matches: delivery
 * URL, epoch, etag, sequence number, object key, part number, track ID,
 * session ID, size, slot ID, and structurally equal `profile` data
 * (`commitId` and `committedAt` may differ). Any other
 * difference is a `conflict` with an `olos.duplicate_commit_conflict`
 * error. Pure.
 */
export function resolveDuplicateCommit(
  options: ResolveDuplicateCommitOptions
): DuplicateCommitResolution {
  assertCommit(options.existingCommit);
  assertCommit(options.candidateCommit);

  if (commitsAreIdempotent(options.existingCommit, options.candidateCommit)) {
    return {
      commit: options.existingCommit,
      status: "idempotent",
    };
  }

  return {
    error: createOlosError(
      "olos.duplicate_commit_conflict",
      "duplicate commit conflicts with the existing commit",
      {
        candidateCommitId: options.candidateCommit.commitId,
        existingCommitId: options.existingCommit.commitId,
        slotId: options.existingCommit.slotId,
      }
    ),
    status: "conflict",
  };
}

export function assertCommitPreconditions(options: CreateCommitOptions): void {
  const { mediaObject, slot } = options;

  assertObservedUploadSlot(slot);
  assertMatchingCommitObject(mediaObject, slot);
  assertCommitObjectSize(mediaObject, slot);
  assertCommitDeadline(options);
}

function assertObservedUploadSlot(
  slot: UploadSlot
): asserts slot is ObservedUploadSlot {
  if (!isObservedUploadSlot(slot)) {
    throw new Error("uploadSlot.state must be upload_observed");
  }
}

function assertMatchingCommitObject(
  mediaObject: StorageObject,
  slot: UploadSlot
): void {
  if (mediaObject.objectKey !== slot.objectKey) {
    throw new Error("mediaObject.objectKey must match uploadSlot.objectKey");
  }

  if (mediaObject.contentType !== slot.contentType) {
    throw new Error(
      "mediaObject.contentType must match uploadSlot.contentType"
    );
  }
}

function assertCommitObjectSize(
  mediaObject: StorageObject,
  slot: UploadSlot
): void {
  if (mediaObject.size > slot.maxBytes) {
    throw new Error("mediaObject.size must be less than or equal to maxBytes");
  }

  if (slot.minBytes !== undefined && mediaObject.size < slot.minBytes) {
    throw new Error(
      "mediaObject.size must be greater than or equal to minBytes"
    );
  }
}

function assertCommitDeadline(options: CreateCommitOptions): void {
  const { slot } = options;
  const committedAt = timestampMs(options.committedAt, "commit.committedAt");
  const expiresAt = timestampMs(slot.expiresAt, "uploadSlot.expiresAt");
  const lateToleranceMs = nonNegativeNumber(
    options.lateToleranceMs ?? 0,
    "lateToleranceMs"
  );

  if (committedAt > expiresAt + lateToleranceMs) {
    throw new Error("commit.committedAt must be before uploadSlot.expiresAt");
  }
}

function isObservedUploadSlot(slot: UploadSlot): slot is ObservedUploadSlot {
  return slot.state === "upload_observed";
}

export function isLateSlot(slot: UploadSlot, cursor: Cursor): boolean {
  const edge = trackWindowBounds(cursor.committedWindow, slot.trackId);

  if (edge === undefined || slot.sequenceNumber > edge.lastSequenceNumber) {
    return false;
  }

  if (slot.sequenceNumber < edge.lastSequenceNumber) {
    return true;
  }

  return (
    slot.partNumber !== undefined &&
    edge.lastPartNumber !== undefined &&
    slot.partNumber <= edge.lastPartNumber
  );
}

function commitsAreIdempotent(first: Commit, second: Commit): boolean {
  return (
    COMMIT_IDEMPOTENCY_FIELDS.every(
      (field) => first[field] === second[field]
    ) && sameProfileData(first.profile, second.profile)
  );
}

const COMMIT_IDEMPOTENCY_FIELDS = [
  "deliveryUrl",
  "epoch",
  "etag",
  "sequenceNumber",
  "objectKey",
  "partNumber",
  "trackId",
  "sessionId",
  "size",
  "slotId",
] as const satisfies readonly (keyof Commit)[];
