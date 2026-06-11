import type { S3Client } from "@aws-sdk/client-s3";
import {
  type CoordinatorUploadCommit,
  commitCoordinatorUpload,
  issueCoordinatorSlot,
} from "../protocol";
import type {
  CoordinatorPipelineState,
  IssueCoordinatorSlotOptions,
} from "../protocol/coordinator";
import type { OlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import { observeS3Object, type S3HeadObjectClient } from "./object-observation";
import { createPresignedS3UploadGrant } from "./upload-grant";

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

export interface IssueS3CoordinatorUploadGrantOptions
  extends IssueCoordinatorSlotOptions {
  additionalHeaders?: Record<string, string>;
  bucket: string;
  client: S3Client;
  expiresInSeconds: number;
  now?: Date | string;
}

export interface S3CoordinatorUploadGrantIssue {
  grant: UploadGrant;
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}

export async function issueS3CoordinatorUploadGrant(
  options: IssueS3CoordinatorUploadGrantOptions
): Promise<S3CoordinatorUploadGrantIssue> {
  const { additionalHeaders, bucket, client, expiresInSeconds, now, ...slot } =
    options;
  const issued = issueCoordinatorSlot(slot);
  const grant = await createPresignedS3UploadGrant({
    additionalHeaders,
    bucket,
    client,
    expiresInSeconds,
    now,
    slot: issued.slot,
  });

  return {
    grant,
    slot: issued.slot,
    state: issued.state,
  };
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
