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

const DEFAULT_OBJECT_OBSERVATION_NOW = () => new Date();

type S3HeadObjectCommandInput = ConstructorParameters<
  typeof HeadObjectCommand
>[0];

/**
 * Narrowed S3 client surface used to verify uploaded objects with
 * `HeadObject`. Lets callers plug in a minimal wrapper rather than the full
 * `@aws-sdk/client-s3` `S3Client`.
 */
export interface S3HeadObjectClient {
  send: (command: HeadObjectCommand) => Promise<HeadObjectCommandOutput>;
}

/** Options for {@link observeS3Object}. */
export interface ObserveS3ObjectOptions {
  bucket: string;
  client: S3HeadObjectClient;
  /** Fallback timestamp source when `now` is unset (default: `new Date`). */
  clock?: () => Date | string;
  /** Fallback observation time when S3 reports no `LastModified`. */
  now?: Date | string;
  objectKey: string;
  /** Observation time override; wins over `LastModified` and `now`. */
  observedAt?: Date | string;
  providerId: string;
  /** S3 object version to observe instead of the latest. */
  versionId?: string;
}

/** Options for {@link createObservedUploadFromS3HeadObject}. */
export interface CreateObservedUploadFromS3HeadObjectOptions {
  /** Fallback timestamp source when `now` is unset (default: `new Date`). */
  clock?: () => Date | string;
  /** Fallback observation time when S3 reports no `LastModified`. */
  now?: Date | string;
  objectKey: string;
  /** Observation time override; wins over `LastModified` and `now`. */
  observedAt?: Date | string;
  /** Raw `HeadObject` output to convert. */
  output: HeadObjectCommandOutput;
  providerId: string;
}

/**
 * Observe an uploaded S3 object with `HeadObject` and convert it into the
 * `ObservedUpload` record that commit paths consume. Throws on invalid
 * options (bucket, key, provider id, timestamps), on S3 request failures,
 * and when the object lacks a content length or content type.
 */
export async function observeS3Object(
  options: ObserveS3ObjectOptions
): Promise<ObservedUpload> {
  assertObserveS3ObjectOptions(options);

  const output = await options.client.send(
    new HeadObjectCommand(s3HeadObjectCommandInput(options))
  );

  return createObservedUploadFromS3HeadObject(
    observedUploadFromS3HeadObjectOptions(options, output)
  );
}

function assertObserveS3ObjectOptions(options: ObserveS3ObjectOptions): void {
  assertS3BucketName(options.bucket);
  assertSafeObjectKey(options.objectKey, "objectKey");
  assertUrlSafeIdentifier(options.providerId, "providerId");

  if (options.observedAt !== undefined) {
    timestampMs(options.observedAt, "observedAt");
  }

  if (options.now !== undefined) {
    timestampMs(options.now, "now");
  }
}

/**
 * Convert an already-fetched `HeadObject` output into an `ObservedUpload`
 * without touching the network. Normalizes slot-id metadata variants onto
 * the canonical `x-olos-slot-id` key and resolves the observation time from
 * `observedAt`, then S3's `LastModified`, then `now`/`clock`. Throws when
 * the output lacks `ContentLength` or `ContentType`.
 */
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

function s3HeadObjectCommandInput(
  options: Pick<ObserveS3ObjectOptions, "bucket" | "objectKey" | "versionId">
): S3HeadObjectCommandInput {
  return {
    Bucket: options.bucket,
    Key: options.objectKey,
    ...(options.versionId === undefined
      ? {}
      : { VersionId: options.versionId }),
  };
}

function observedUploadFromS3HeadObjectOptions(
  options: ObserveS3ObjectOptions,
  output: HeadObjectCommandOutput
): CreateObservedUploadFromS3HeadObjectOptions {
  return {
    clock: options.clock,
    now: options.now,
    objectKey: options.objectKey,
    observedAt: options.observedAt,
    output,
    providerId: options.providerId,
  };
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
    return observedAtTimestamp(options.observedAt);
  }

  if (options.output.LastModified !== undefined) {
    return lastModifiedTimestamp(options.output.LastModified);
  }

  return fallbackObservedAtTimestamp(options);
}

function observedAtTimestamp(value: Date | string): string {
  return new Date(timestampMs(value, "observedAt")).toISOString();
}

function lastModifiedTimestamp(value: Date): string {
  return value.toISOString();
}

function fallbackObservedAtTimestamp(options: {
  clock?: () => Date | string;
  now?: Date | string;
}): string {
  return new Date(observedAtNowMs(options)).toISOString();
}

function observedAtNowMs(options: {
  clock?: () => Date | string;
  now?: Date | string;
}): number {
  return timestampMs(resolveObservedAtNow(options), "now");
}

function resolveObservedAtNow(options: {
  clock?: () => Date | string;
  now?: Date | string;
}): Date | string {
  return (
    options.now ??
    (options.clock === undefined
      ? DEFAULT_OBJECT_OBSERVATION_NOW()
      : options.clock())
  );
}
