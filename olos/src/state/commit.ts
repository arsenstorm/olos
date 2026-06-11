import type { Commit } from "../types/commit";
import type { OlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { MediaObject } from "../types/media-object";
import type { UploadSlot } from "../types/upload-slot";
import { assertCommit } from "../validation/commit";
import { assertMediaObject } from "../validation/media-object";
import type { ObservedUpload } from "../validation/observed-upload";
import { assertUploadSlot } from "../validation/upload-slot";
import { assertUploadSlotTransition, observeUpload } from "./upload-slot";

export interface CreateCommitOptions {
  commitId: OlosId;
  committedAt: string;
  independent?: boolean;
  mediaObject: MediaObject;
  programDateTime?: string;
  slot: UploadSlot;
}

export type ResolveUploadCommitOptions = CreateCommitOptions;

export interface UploadCommitResolution {
  commit: Commit;
  slot: UploadSlot;
}

export interface ResolveCommitAttemptOptions
  extends Omit<CreateCommitOptions, "slot"> {
  slot?: UploadSlot;
  slotId: OlosId;
}

export type CommitAttemptResolution =
  | {
      commit: Commit;
      slot: UploadSlot;
      status: "committed";
    }
  | {
      error: OlosError;
      status: "key_mismatch" | "object_too_large" | "unknown_slot";
    };

export interface CommitObservedUploadOptions {
  commitId: OlosId;
  committedAt: string;
  independent?: boolean;
  object: ObservedUpload;
  programDateTime?: string;
  slot: UploadSlot;
}

export interface CommitObservedUploadResult {
  commit: Commit;
  slot: UploadSlot;
}

export interface ResolveDuplicateCommitOptions {
  candidateCommit: Commit;
  existingCommit: Commit;
}

export type DuplicateCommitResolution =
  | {
      commit: Commit;
      status: "idempotent";
    }
  | {
      error: OlosError;
      status: "conflict";
    };

export function createCommit(options: CreateCommitOptions): Commit {
  assertUploadSlot(options.slot);
  assertMediaObject(options.mediaObject);
  assertCommitPreconditions(options);

  const commit: Commit = {
    commitId: options.commitId,
    committedAt: options.committedAt,
    deliveryUrl: options.slot.deliveryUrl,
    duration: options.slot.duration,
    epoch: options.slot.epoch,
    ...(options.mediaObject.etag === undefined
      ? {}
      : { etag: options.mediaObject.etag }),
    ...(options.independent === undefined
      ? {}
      : { independent: options.independent }),
    mediaSequenceNumber: options.slot.mediaSequenceNumber,
    objectKey: options.slot.objectKey,
    ...(options.slot.partNumber === undefined
      ? {}
      : { partNumber: options.slot.partNumber }),
    ...(options.programDateTime === undefined
      ? {}
      : { programDateTime: options.programDateTime }),
    providerId: options.mediaObject.providerId,
    publicationMode: options.slot.publicationMode,
    renditionId: options.slot.renditionId,
    sessionId: options.slot.sessionId,
    size: options.mediaObject.size,
    slotId: options.slot.slotId,
  };

  assertCommit(commit);
  return commit;
}

export function commitObservedUpload(
  options: CommitObservedUploadOptions
): CommitObservedUploadResult {
  const slot = observeUpload({
    object: options.object,
    slot: options.slot,
  });

  return resolveUploadCommit({
    commitId: options.commitId,
    committedAt: options.committedAt,
    independent: options.independent,
    mediaObject: options.object,
    programDateTime: options.programDateTime,
    slot,
  });
}

export function resolveUploadCommit(
  options: ResolveUploadCommitOptions
): UploadCommitResolution {
  const commit = createCommit(options);

  assertUploadSlotTransition(options.slot.state, "committed");

  return {
    commit,
    slot: {
      ...options.slot,
      state: "committed",
    },
  };
}

export function resolveCommitAttempt(
  options: ResolveCommitAttemptOptions
): CommitAttemptResolution {
  if (options.slot === undefined) {
    return {
      error: commitError("olos.unknown_slot", "upload slot is unknown", {
        slotId: options.slotId,
      }),
      status: "unknown_slot",
    };
  }

  if (options.mediaObject.objectKey !== options.slot.objectKey) {
    return {
      error: commitError(
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

  if (options.mediaObject.size > options.slot.maxBytes) {
    return {
      error: commitError("olos.object_too_large", "object exceeds slot limit", {
        maxBytes: options.slot.maxBytes,
        objectKey: options.mediaObject.objectKey,
        size: options.mediaObject.size,
        slotId: options.slot.slotId,
      }),
      status: "object_too_large",
    };
  }

  const result = resolveUploadCommit({
    commitId: options.commitId,
    committedAt: options.committedAt,
    independent: options.independent,
    mediaObject: options.mediaObject,
    programDateTime: options.programDateTime,
    slot: options.slot,
  });

  return {
    ...result,
    status: "committed",
  };
}

function commitError(
  code: OlosError["error"]["code"],
  message: string,
  details?: Record<string, unknown>
): OlosError {
  return {
    error: {
      code,
      ...(details === undefined ? {} : { details }),
      message,
    },
  };
}

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
    error: {
      error: {
        code: "olos.duplicate_commit_conflict",
        details: {
          candidateCommitId: options.candidateCommit.commitId,
          existingCommitId: options.existingCommit.commitId,
          slotId: options.existingCommit.slotId,
        },
        message: "duplicate commit conflicts with the existing commit",
      },
    },
    status: "conflict",
  };
}

function assertCommitPreconditions(options: CreateCommitOptions): void {
  const { mediaObject, slot } = options;

  if (slot.state !== "upload_observed") {
    throw new Error("uploadSlot.state must be upload_observed");
  }

  if (mediaObject.objectKey !== slot.objectKey) {
    throw new Error("mediaObject.objectKey must match uploadSlot.objectKey");
  }

  if (mediaObject.contentType !== slot.contentType) {
    throw new Error(
      "mediaObject.contentType must match uploadSlot.contentType"
    );
  }

  if (mediaObject.size > slot.maxBytes) {
    throw new Error("mediaObject.size must be less than or equal to maxBytes");
  }

  if (slot.minBytes !== undefined && mediaObject.size < slot.minBytes) {
    throw new Error(
      "mediaObject.size must be greater than or equal to minBytes"
    );
  }

  const committedAt = timestampMs(options.committedAt, "commit.committedAt");
  const expiresAt = timestampMs(slot.expiresAt, "uploadSlot.expiresAt");

  if (committedAt > expiresAt) {
    throw new Error("commit.committedAt must be before uploadSlot.expiresAt");
  }
}

function timestampMs(value: string, name: string): number {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    throw new Error(`${name} must be a valid timestamp`);
  }

  return timestamp;
}

function commitsAreIdempotent(first: Commit, second: Commit): boolean {
  return COMMIT_IDEMPOTENCY_FIELDS.every(
    (field) => first[field] === second[field]
  );
}

const COMMIT_IDEMPOTENCY_FIELDS = [
  "deliveryUrl",
  "duration",
  "epoch",
  "etag",
  "independent",
  "mediaSequenceNumber",
  "objectKey",
  "partNumber",
  "programDateTime",
  "providerId",
  "publicationMode",
  "renditionId",
  "sessionId",
  "size",
  "slotId",
] as const satisfies readonly (keyof Commit)[];
