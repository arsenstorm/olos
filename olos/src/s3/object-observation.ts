import {
  HeadObjectCommand,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { timestampMs } from "../runtime/request-fields";
import { createObservedUpload } from "../state/observed-upload";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertSafeObjectKey } from "../validation/object-key";
import type { ObservedUpload } from "../validation/observed-upload";
import { assertS3BucketName } from "./bucket";

export interface S3HeadObjectClient {
  send(command: HeadObjectCommand): Promise<HeadObjectCommandOutput>;
}

export interface ObserveS3ObjectOptions {
  bucket: string;
  client: S3HeadObjectClient;
  objectKey: string;
  observedAt?: Date | string;
  providerId: string;
  versionId?: string;
}

export interface CreateObservedUploadFromS3HeadObjectOptions {
  objectKey: string;
  observedAt?: Date | string;
  output: HeadObjectCommandOutput;
  providerId: string;
}

export async function observeS3Object(
  options: ObserveS3ObjectOptions
): Promise<ObservedUpload> {
  assertObserveS3ObjectOptions(options);

  const output = await options.client.send(
    new HeadObjectCommand({
      Bucket: options.bucket,
      Key: options.objectKey,
      ...(options.versionId === undefined
        ? {}
        : { VersionId: options.versionId }),
    })
  );

  return createObservedUploadFromS3HeadObject({
    objectKey: options.objectKey,
    observedAt: options.observedAt,
    output,
    providerId: options.providerId,
  });
}

function assertObserveS3ObjectOptions(options: ObserveS3ObjectOptions): void {
  assertS3BucketName(options.bucket);
  assertSafeObjectKey(options.objectKey, "objectKey");
  assertUrlSafeIdentifier(options.providerId, "providerId");

  if (options.observedAt !== undefined) {
    timestampMs(options.observedAt, "observedAt");
  }
}

export function createObservedUploadFromS3HeadObject(
  options: CreateObservedUploadFromS3HeadObjectOptions
): ObservedUpload {
  if (options.output.ContentLength === undefined) {
    throw new Error("headObject.ContentLength must be present");
  }

  if (options.output.ContentType === undefined) {
    throw new Error("headObject.ContentType must be present");
  }

  return createObservedUpload({
    contentType: options.output.ContentType,
    etag: options.output.ETag,
    metadata: normalizeS3Metadata(options.output.Metadata),
    objectKey: options.objectKey,
    observedAt: observedAt(options),
    providerId: options.providerId,
    size: options.output.ContentLength,
  });
}

function normalizeS3Metadata(
  metadata: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (metadata === undefined) {
    return;
  }

  const slotId =
    metadata["x-olos-slot-id"] ??
    metadata["olos-slot-id"] ??
    metadata["x-amz-meta-olos-slot-id"];

  if (slotId === undefined || metadata["x-olos-slot-id"] !== undefined) {
    return metadata;
  }

  return {
    ...metadata,
    "x-olos-slot-id": slotId,
  };
}

function observedAt(
  options: CreateObservedUploadFromS3HeadObjectOptions
): string {
  if (options.observedAt !== undefined) {
    return new Date(
      timestampMs(options.observedAt, "observedAt")
    ).toISOString();
  }

  if (options.output.LastModified !== undefined) {
    return options.output.LastModified.toISOString();
  }

  return new Date().toISOString();
}
