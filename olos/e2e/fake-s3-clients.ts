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
  inputs: unknown[],
  sizes: Record<string, number> | ObjectSizeResolver
): S3HeadObjectClient {
  return createSourceTestHeadObjectClientFor(inputs, sizes);
}

export function createTestDeleteObjectClient(
  inputs: unknown[],
  failingKey?: string
): S3DeleteObjectClient {
  return createTestS3DeleteObjectClient(inputs, failingKey);
}
