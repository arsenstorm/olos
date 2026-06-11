import type { Commit } from "../types/commit";
import type { OlosId } from "../types/ids";
import type { MediaObject } from "../types/media-object";
import type { UploadSlot } from "../types/upload-slot";
import { assertCommit } from "../validation/commit";
import { assertMediaObject } from "../validation/media-object";
import { assertUploadSlot } from "../validation/upload-slot";

export interface CreateCommitOptions {
  commitId: OlosId;
  committedAt: string;
  independent?: boolean;
  mediaObject: MediaObject;
  programDateTime?: string;
  slot: UploadSlot;
}

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
