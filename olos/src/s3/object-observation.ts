import {
  HeadObjectCommand,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { createObservedUpload } from "../state/observed-upload";
import type { ObservedUpload } from "../validation/observed-upload";

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
    metadata: options.output.Metadata,
    objectKey: options.objectKey,
    observedAt: observedAt(options),
    providerId: options.providerId,
    size: options.output.ContentLength,
  });
}

function observedAt(
  options: CreateObservedUploadFromS3HeadObjectOptions
): string {
  if (options.observedAt !== undefined) {
    return new Date(options.observedAt).toISOString();
  }

  if (options.output.LastModified !== undefined) {
    return options.output.LastModified.toISOString();
  }

  return new Date().toISOString();
}
