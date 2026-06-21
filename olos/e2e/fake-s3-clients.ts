import type { S3DeleteObjectClient, S3HeadObjectClient } from "olos/s3";
import {
  createTestHeadObjectClientFor as createSourceTestHeadObjectClientFor,
  createTestS3Client as createSourceTestS3Client,
} from "../src/s3/test-client.test-helper";
import { createTestS3DeleteObjectClient } from "../src/s3/test-delete-client.test-helper";

type ObjectSizeResolver = (objectKey: string) => number | undefined;

export function createTestS3Client(): ReturnType<
  typeof createSourceTestS3Client
> {
  return createSourceTestS3Client();
}

export function createTestHeadObjectClient(
  inputs: unknown[],
  size: number
): S3HeadObjectClient {
  return createTestHeadObjectClientFor(inputs, () => size);
}

export function createTestHeadObjectClientFor(
  first: unknown[] | Record<string, number> | ObjectSizeResolver,
  second: unknown[] | Record<string, number> | ObjectSizeResolver
): S3HeadObjectClient {
  const inputs = Array.isArray(first) ? first : (second as unknown[]);
  const sizes = Array.isArray(first)
    ? (second as Record<string, number> | ObjectSizeResolver)
    : (first as Record<string, number> | ObjectSizeResolver);

  return createSourceTestHeadObjectClientFor(inputs, sizes);
}

export function createTestDeleteObjectClient(
  inputs: unknown[],
  failingKey?: string
): S3DeleteObjectClient {
  return createTestS3DeleteObjectClient(inputs, failingKey);
}
