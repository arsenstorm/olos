import {
  type CoordinatorUploadCommit,
  commitCoordinatorUpload,
} from "../protocol";
import type { CoordinatorPipelineState } from "../protocol/coordinator";
import type { OlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import { observeS3Object, type S3HeadObjectClient } from "./object-observation";

export interface CommitS3CoordinatorUploadOptions {
  bucket: string;
  client: S3HeadObjectClient;
  commitId: OlosId;
  committedAt: string;
  independent?: boolean;
  maxSegments?: number;
  programDateTime?: string;
  providerId: string;
  slotId: OlosId;
  state: CoordinatorPipelineState;
  versionId?: string;
}

export async function commitS3CoordinatorUpload(
  options: CommitS3CoordinatorUploadOptions
): Promise<CoordinatorUploadCommit> {
  const slot = options.state.slots.find(
    (entry) => entry.slotId === options.slotId
  );

  if (slot === undefined) {
    return {
      error: coordinatorError("olos.unknown_slot", "upload slot is unknown", {
        slotId: options.slotId,
      }),
      state: options.state,
      status: "rejected",
    };
  }

  const object = await observeS3Object({
    bucket: options.bucket,
    client: options.client,
    objectKey: slot.objectKey,
    observedAt: options.committedAt,
    providerId: options.providerId,
    versionId: options.versionId,
  });

  return commitCoordinatorUpload({
    commitId: options.commitId,
    committedAt: options.committedAt,
    independent: options.independent,
    maxSegments: options.maxSegments,
    object,
    programDateTime: options.programDateTime,
    slotId: options.slotId,
    state: options.state,
  });
}

function coordinatorError(
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
