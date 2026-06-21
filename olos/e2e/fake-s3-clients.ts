import {
  type DeleteObjectCommand,
  type DeleteObjectCommandOutput,
  type HeadObjectCommand,
  type HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import type { S3DeleteObjectClient, S3HeadObjectClient } from "olos/s3";

type ObjectSizeResolver = (objectKey: string) => number | undefined;

export function createTestS3Client(): S3Client {
  return new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    endpoint: "https://s3.example.com",
    forcePathStyle: true,
    region: "us-east-1",
  });
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
  const resolveSize =
    typeof sizes === "function"
      ? sizes
      : (objectKey: string) => sizes[objectKey];

  return {
    send(command: HeadObjectCommand): Promise<HeadObjectCommandOutput> {
      inputs.push(command.input);

      const objectKey = String(command.input.Key);
      const resolvedSize = resolveSize(objectKey);

      if (resolvedSize === undefined) {
        return Promise.reject(new Error(`unexpected object key: ${objectKey}`));
      }

      return Promise.resolve({
        $metadata: {},
        ContentLength: resolvedSize,
        ContentType: "video/mp4",
        ETag: `"${objectKey}"`,
        LastModified: new Date("2026-01-01T00:00:01.000Z"),
      });
    },
  };
}

export function createTestDeleteObjectClient(
  inputs: unknown[],
  failingKey?: string
): S3DeleteObjectClient {
  return {
    send(command: DeleteObjectCommand): Promise<DeleteObjectCommandOutput> {
      inputs.push(command.input);

      if (command.input.Key === failingKey) {
        throw new Error("delete failed");
      }

      return Promise.resolve({ $metadata: {} });
    },
  };
}
