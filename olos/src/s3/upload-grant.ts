import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { timestampMs } from "../runtime/request-fields";
import {
  assertAdditionalUploadHeaders,
  createUploadGrant,
} from "../state/upload-grant";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import { parseAbsoluteHttpUrl, positiveNumber } from "../validation/fields";
import { assertUploadSlot } from "../validation/upload-slot";
import { assertS3BucketName } from "./bucket";

const S3_METADATA_HEADER_PREFIX = "x-amz-meta-olos-";
const DEFAULT_UPLOAD_GRANT_NOW = () => new Date();

/** Options for {@link createS3UploadGrant}. */
export interface CreateS3UploadGrantOptions {
  /**
   * Extra headers the uploader must send; must not override the
   * `x-amz-meta-olos-*` slot metadata headers.
   */
  additionalHeaders?: Record<string, string>;
  /** Required to validate path-style (bucket-in-path) presigned URLs. */
  bucket?: string;
  /** ISO 8601 expiry recorded on the grant. */
  expiresAt?: string;
  /** Presigned S3 PUT URL; its path must match the slot's object key. */
  presignedUrl: string;
  slot: UploadSlot;
}

/** Options for {@link createPresignedS3UploadGrant}. */
export interface CreatePresignedS3UploadGrantOptions {
  /**
   * Extra headers the uploader must send; must not override the
   * `x-amz-meta-olos-*` slot metadata headers.
   */
  additionalHeaders?: Record<string, string>;
  bucket: string;
  client: S3Client;
  /** Fallback timestamp source when `now` is unset (default: `new Date`). */
  clock?: () => Date | string;
  /**
   * Presigned URL lifetime in seconds. The grant must not outlive the
   * slot's own `expiresAt`.
   */
  expiresInSeconds: number;
  /** Timestamp the grant expiry is computed from; wins over `clock`. */
  now?: Date | string;
  /** Slot to presign for; must be in the `issued` state. */
  slot: UploadSlot;
}

/**
 * Wrap an externally presigned S3 PUT URL in an OLOS upload grant. Verifies
 * the URL's path matches the slot's object key (virtual-hosted style, or
 * path style when `bucket` is given) and merges the slot metadata headers
 * with any additional headers; throws on a mismatch or when additional
 * headers try to override `x-amz-meta-olos-*` metadata. Use
 * {@link createPresignedS3UploadGrant} to presign in the same call.
 */
export function createS3UploadGrant(
  options: CreateS3UploadGrantOptions
): UploadGrant {
  if (options.bucket !== undefined) {
    assertS3BucketName(options.bucket);
  }

  assertPresignedUrlMatchesSlot(options);

  return createUploadGrant({
    additionalHeaders: createS3AdditionalHeaders(options),
    expiresAt: options.expiresAt,
    slot: options.slot,
    url: options.presignedUrl,
  });
}

function assertPresignedUrlMatchesSlot(
  options: CreateS3UploadGrantOptions
): void {
  const pathSegments = pathParts(
    parseAbsoluteHttpUrl(options.presignedUrl, "presignedUrl", {
      allowQueryOrFragment: true,
    }).pathname
  );
  const keySegments = pathParts(options.slot.objectKey);

  if (presignedPathMatchesSlot(pathSegments, keySegments, options.bucket)) {
    return;
  }

  throw new Error("presignedUrl path must match uploadSlot.objectKey");
}

function presignedPathMatchesSlot(
  pathSegments: readonly string[],
  keySegments: readonly string[],
  bucket: string | undefined
): boolean {
  return (
    virtualHostedPresignedPathMatchesSlot(pathSegments, keySegments) ||
    pathStylePresignedPathMatchesSlot(pathSegments, keySegments, bucket)
  );
}

function virtualHostedPresignedPathMatchesSlot(
  pathSegments: readonly string[],
  keySegments: readonly string[]
): boolean {
  return pathSegments.join("/") === keySegments.join("/");
}

function pathStylePresignedPathMatchesSlot(
  pathSegments: readonly string[],
  keySegments: readonly string[],
  bucket: string | undefined
): boolean {
  return (
    bucket !== undefined &&
    pathSegments[0] === bucket &&
    pathSegments.slice(1).join("/") === keySegments.join("/")
  );
}

function pathParts(value: string): string[] {
  return value.split("/").filter(Boolean);
}

/**
 * Presign an S3 PUT for an issued slot and wrap it in an OLOS upload grant.
 * The signed request pins the slot's content type, sets `If-None-Match: *`
 * so the upload cannot overwrite an existing object, and signs the
 * `x-amz-meta-olos-*` slot metadata headers so uploaders cannot drop or
 * alter them. Throws when the slot is not in the `issued` state or when the
 * grant would expire after the slot's own `expiresAt`.
 */
export async function createPresignedS3UploadGrant(
  options: CreatePresignedS3UploadGrantOptions
): Promise<UploadGrant> {
  assertPresignedS3UploadGrantOptions(options);

  const requiredHeaders = createRequiredHeaders(options);
  const command = new PutObjectCommand({
    Bucket: options.bucket,
    ContentType: options.slot.contentType,
    IfNoneMatch: "*",
    Key: options.slot.objectKey,
  });

  command.middlewareStack.add(
    (next) => (args) => {
      const request = args.request;

      if (isHeaderRequest(request)) {
        request.headers = {
          ...request.headers,
          ...requiredHeaders,
        };
      }

      return next(args);
    },
    {
      name: "olosS3UploadGrantHeaders",
      step: "build",
    }
  );

  const presignedUrl = await getSignedUrl(options.client, command, {
    expiresIn: options.expiresInSeconds,
    signableHeaders: new Set(Object.keys(requiredHeaders).map(lowercase)),
    unhoistableHeaders: new Set(
      Object.keys(requiredHeaders).filter(isAmzHeader).map(lowercase)
    ),
  });

  return createS3UploadGrant({
    additionalHeaders: options.additionalHeaders,
    bucket: options.bucket,
    expiresAt: expiresAt(options),
    presignedUrl,
    slot: options.slot,
  });
}

function assertPresignedS3UploadGrantOptions(
  options: CreatePresignedS3UploadGrantOptions
): void {
  assertUploadSlot(options.slot);
  assertS3BucketName(options.bucket);
  positiveNumber(options.expiresInSeconds, "expiresInSeconds");

  assertPresignedGrantSlotIsIssued(options.slot);
  assertPresignedGrantExpiresWithinSlot(options);
}

function assertPresignedGrantSlotIsIssued(slot: UploadSlot): void {
  if (slot.state !== "issued") {
    throw new Error("uploadSlot.state must be issued");
  }
}

function assertPresignedGrantExpiresWithinSlot(
  options: CreatePresignedS3UploadGrantOptions
): void {
  const grantExpiresAt =
    resolveNowTimestampMs(options.now, options.clock) +
    options.expiresInSeconds * 1000;
  const slotExpiresAt = timestampMs(
    options.slot.expiresAt,
    "uploadSlot.expiresAt"
  );

  if (grantExpiresAt > slotExpiresAt) {
    throw new Error(
      "uploadGrant.expiresAt must be before or equal to uploadSlot.expiresAt"
    );
  }
}

function createRequiredHeaders(
  options: CreatePresignedS3UploadGrantOptions
): Record<string, string> {
  return {
    "Content-Type": options.slot.contentType,
    "If-None-Match": "*",
    "x-olos-slot-id": options.slot.slotId,
    ...createS3AdditionalHeaders(options),
  };
}

function createS3AdditionalHeaders(options: {
  additionalHeaders?: Record<string, string>;
  slot: UploadSlot;
}): Record<string, string> {
  assertDoesNotOverrideS3Metadata(options.additionalHeaders);

  return {
    ...createS3SlotMetadataHeaders(options.slot),
    ...options.additionalHeaders,
  };
}

function createS3SlotMetadataHeaders(slot: UploadSlot): Record<string, string> {
  return {
    ...createBaseS3SlotMetadataHeaders(slot),
    ...createPartS3SlotMetadataHeaders(slot),
  };
}

function createBaseS3SlotMetadataHeaders(
  slot: UploadSlot
): Record<string, string> {
  return {
    "x-amz-meta-olos-epoch": String(slot.epoch),
    "x-amz-meta-olos-kind": slot.kind,
    "x-amz-meta-olos-media-sequence-number": String(slot.mediaSequenceNumber),
    "x-amz-meta-olos-rendition-id": slot.renditionId,
    "x-amz-meta-olos-session-id": slot.sessionId,
    "x-amz-meta-olos-slot-id": slot.slotId,
  };
}

function createPartS3SlotMetadataHeaders(
  slot: UploadSlot
): Record<string, string> {
  if (slot.partNumber === undefined) {
    return {};
  }

  return {
    "x-amz-meta-olos-part-number": String(slot.partNumber),
  };
}

function assertDoesNotOverrideS3Metadata(
  headers: Record<string, string> | undefined
): void {
  if (headers === undefined) {
    return;
  }

  assertAdditionalUploadHeaders(headers);

  for (const header of Object.keys(headers)) {
    if (header.toLowerCase().startsWith(S3_METADATA_HEADER_PREFIX)) {
      throw new Error(`additionalHeaders must not override ${header}`);
    }
  }
}

function expiresAt(options: CreatePresignedS3UploadGrantOptions): string {
  const nowMs = resolveNowTimestampMs(options.now, options.clock);

  return new Date(nowMs + options.expiresInSeconds * 1000).toISOString();
}

function resolveNowTimestampMs(
  now: Date | string | undefined,
  clock: (() => Date | string) | undefined
): number {
  return timestampMs(resolveNow(now, clock), "now");
}

function resolveNow(
  now: Date | string | undefined,
  clock: (() => Date | string) | undefined
): Date | string {
  return now ?? (clock === undefined ? DEFAULT_UPLOAD_GRANT_NOW() : clock());
}

function isHeaderRequest(
  value: unknown
): value is { headers: Record<string, string> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "headers" in value &&
    typeof value.headers === "object" &&
    value.headers !== null
  );
}

function lowercase(value: string): string {
  return value.toLowerCase();
}

function isAmzHeader(value: string): boolean {
  return value.toLowerCase().startsWith("x-amz-");
}
