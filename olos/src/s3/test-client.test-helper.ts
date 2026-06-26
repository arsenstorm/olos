import type {
  HeadObjectCommand,
  HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { S3Client } from "@aws-sdk/client-s3";
import type { S3HeadObjectClient } from "./object-observation";

type ObjectSizeResolver = (objectKey: string) => number | undefined;

interface HeadObjectClientOptions {
  lastModified?: Record<string, string>;
  metadata?: Record<string, Record<string, string>>;
  missingObjectError?: (objectKey: string) => string;
}

const createHeadObjectMetadata = (
  objectKey: string,
  metadata?: Record<string, Record<string, string>>
): Record<string, string> | undefined =>
  metadata === undefined ? undefined : metadata[objectKey];

const DEFAULT_HEAD_OBJECT_CONTENT_TYPE = "video/mp4";
const DEFAULT_HEAD_OBJECT_LAST_MODIFIED = "2026-01-01T00:00:01.000Z";

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
  sizes: Record<string, number> | ObjectSizeResolver,
  inputs: unknown[],
  contentTypes: Record<string, string> = {},
  lastModified: Record<string, string> = {},
  options: HeadObjectClientOptions = {}
): S3HeadObjectClient {
  return createTestHeadObjectClientFor(
    inputs,
    sizes,
    contentTypes,
    lastModified,
    options
  );
}

export function createTestHeadObjectClientFor(
  inputs: unknown[],
  sizes: Record<string, number> | ObjectSizeResolver,
  contentTypes: Record<string, string> = {},
  lastModified: Record<string, string> = {},
  options: HeadObjectClientOptions = {}
): S3HeadObjectClient {
  const resolveSize = createObjectSizeResolver(sizes);
  const resolveMissingObjectError =
    options.missingObjectError ??
    ((objectKey) => `unexpected object key: ${objectKey}`);
  const metadata = options.metadata;

  return {
    send(command: HeadObjectCommand): Promise<HeadObjectCommandOutput> {
      inputs.push(command.input);

      const objectKey = String(command.input.Key);
      const size = resolveSize(objectKey);

      if (size === undefined) {
        return Promise.reject(new Error(resolveMissingObjectError(objectKey)));
      }

      const objectMetadata = createHeadObjectMetadata(objectKey, metadata);
      return Promise.resolve(
        createHeadObjectOutput(objectKey, size, {
          contentTypes,
          lastModified,
          metadata: objectMetadata,
        })
      );
    },
  };
}

function createObjectSizeResolver(
  sizes: Record<string, number> | ObjectSizeResolver
): ObjectSizeResolver {
  return typeof sizes === "function"
    ? sizes
    : (objectKey: string) => sizes[objectKey];
}

function createHeadObjectOutput(
  objectKey: string,
  size: number,
  options: {
    contentTypes: Record<string, string>;
    lastModified: Record<string, string>;
    metadata: Record<string, string> | undefined;
  }
): HeadObjectCommandOutput {
  return {
    $metadata: {},
    ContentLength: size,
    ContentType:
      options.contentTypes[objectKey] ?? DEFAULT_HEAD_OBJECT_CONTENT_TYPE,
    ETag: `"${objectKey}"`,
    LastModified: new Date(
      options.lastModified[objectKey] ?? DEFAULT_HEAD_OBJECT_LAST_MODIFIED
    ),
    ...(options.metadata === undefined ? {} : { Metadata: options.metadata }),
  };
}

export function createTestHeadObjectClientForSingle(
  objectKey: string,
  size: number,
  inputs: unknown[],
  contentType = "video/mp4",
  metadata?: Record<string, string>,
  missingObjectError?: (objectKey: string) => string
): S3HeadObjectClient {
  return createTestHeadObjectClientFor(
    inputs,
    { [objectKey]: size },
    { [objectKey]: contentType },
    {},
    {
      ...(metadata === undefined
        ? {}
        : { metadata: { [objectKey]: metadata } }),
      ...(missingObjectError === undefined ? {} : { missingObjectError }),
    }
  );
}
