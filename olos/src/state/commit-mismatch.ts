import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import { createOlosError } from "../types/errors";
import type { StorageObject } from "../types/storage-object";
import type { UploadSlot } from "../types/upload-slot";
import { assertCommit } from "../validation/commit";
import {
  isAfterSlotExpiry,
  type ObjectSlotMismatch,
  objectSlotMismatch,
} from "../validation/observed-upload";
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
  const mismatch = objectSlotMismatch(options.mediaObject, options.slot, {
    includeKeyMismatch: options.includeKeyMismatch === true,
  });

  if (mismatch !== undefined) {
    return OBJECT_SLOT_MISMATCH_RESOLUTIONS[mismatch](options);
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

const OBJECT_SLOT_MISMATCH_RESOLUTIONS: Readonly<
  Record<
    ObjectSlotMismatch,
    (options: ResolveObjectSlotMismatchOptions) => ObjectSlotMismatchResolution
  >
> = {
  contentType: contentTypeMismatch,
  maxBytes: objectTooLarge,
  minBytes: objectTooSmall,
  objectKey: keyMismatch,
};

const COMMIT_OBJECT_MISMATCH_MESSAGES: Readonly<
  Record<ObjectSlotMismatch, string>
> = {
  contentType: "mediaObject.contentType must match uploadSlot.contentType",
  maxBytes: "mediaObject.size must be less than or equal to maxBytes",
  minBytes: "mediaObject.size must be greater than or equal to minBytes",
  objectKey: "mediaObject.objectKey must match uploadSlot.objectKey",
};

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
  assertCommitObjectMatchesSlot(mediaObject, slot);
  assertCommitDeadline(options);
}

function assertObservedUploadSlot(
  slot: UploadSlot
): asserts slot is ObservedUploadSlot {
  if (!isObservedUploadSlot(slot)) {
    throw new Error("uploadSlot.state must be upload_observed");
  }
}

function assertCommitObjectMatchesSlot(
  mediaObject: StorageObject,
  slot: UploadSlot
): void {
  const mismatch = objectSlotMismatch(mediaObject, slot, {
    includeKeyMismatch: true,
  });

  if (mismatch !== undefined) {
    throw new Error(COMMIT_OBJECT_MISMATCH_MESSAGES[mismatch]);
  }
}

function assertCommitDeadline(options: CreateCommitOptions): void {
  if (
    isAfterSlotExpiry(
      options.committedAt,
      options.slot,
      options.lateToleranceMs,
      "commit.committedAt"
    )
  ) {
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
