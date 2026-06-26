import type { S3GetObjectClient } from "@arsenstorm/olos/s3";
import type {
  GetObjectCommand,
  GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { NoSuchKey } from "@aws-sdk/client-s3";

const RANGE_PATTERN = /^bytes=(\d+)-(\d*)$/;

/**
 * Wraps an R2 binding to satisfy OLOS's `S3GetObjectClient` interface so the
 * byterange helper and media proxy can pull bytes via `env.MEDIA.get(...)`
 * instead of the S3 SDK. Used in production where the binding sidesteps
 * AWS Signature V4 signing CPU and a small per-op cost. In local dev we
 * stay on the S3 path because Miniflare's R2 emulator is a separate
 * bucket from MinIO.
 */
export class R2GetObjectClient implements S3GetObjectClient {
  private readonly bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  async send(command: GetObjectCommand): Promise<GetObjectCommandOutput> {
    const { Key, Range } = command.input;
    if (Key === undefined) {
      throw new Error("R2GetObjectClient: Key is required");
    }

    const object = await this.bucket.get(Key, parseR2GetOptions(Range));
    if (object === null) {
      throw new NoSuchKey({
        $metadata: {},
        message: `R2 key not found: ${Key}`,
      });
    }

    return {
      $metadata: {},
      Body: {
        transformToWebStream: () => object.body,
      },
      ContentLength: object.size,
      ContentType: object.httpMetadata?.contentType,
    } as unknown as GetObjectCommandOutput;
  }
}

function parseR2GetOptions(
  range: string | undefined
): R2GetOptions | undefined {
  if (range === undefined) {
    return;
  }
  const match = RANGE_PATTERN.exec(range);
  if (match === null) {
    return;
  }
  const offset = Number(match[1]);
  const endRaw = match[2];
  if (endRaw === "") {
    return { range: { offset } };
  }
  return { range: { length: Number(endRaw) - offset + 1, offset } };
}
