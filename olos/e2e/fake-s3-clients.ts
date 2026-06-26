import type {
  S3DeleteObjectClient,
  S3HeadObjectClient,
} from "@arsenstorm/olos/s3";
import {
  createTestHeadObjectClientFor as createSourceTestHeadObjectClientFor,
  createTestS3Client as createSourceTestS3Client,
} from "../src/s3/test-client.test-helper";
import { createTestS3DeleteObjectClient } from "../src/s3/test-delete-client.test-helper";

type ObjectSizeResolver = (objectKey: string) => number | undefined;
type ObjectSizeFixtures =
  | ReadonlyMap<string, number>
  | Record<string, number>
  | ObjectSizeResolver;

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
  first: unknown[] | ObjectSizeFixtures,
  second: unknown[] | ObjectSizeFixtures
): S3HeadObjectClient {
  const inputs = Array.isArray(first) ? first : (second as unknown[]);
  const sizes = Array.isArray(first)
    ? toObjectSizeResolver(second as ObjectSizeFixtures)
    : toObjectSizeResolver(first as ObjectSizeFixtures);

  return createSourceTestHeadObjectClientFor(inputs, sizes);
}

function toObjectSizeResolver(sizes: ObjectSizeFixtures): ObjectSizeResolver {
  if (typeof sizes === "function") {
    return sizes;
  }

  if (sizes instanceof Map) {
    return (objectKey) => sizes.get(objectKey);
  }

  return (objectKey) => sizes[objectKey];
}

export function createTestDeleteObjectClient(
  inputs: unknown[],
  failingKey?: string
): S3DeleteObjectClient {
  return createTestS3DeleteObjectClient(inputs, failingKey);
}
