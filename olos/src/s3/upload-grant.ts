import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { timestampMs } from "../runtime/request-fields";
import {
  assertAdditionalUploadHeaders,
  createUploadGrant,
} from "../state/upload-grant";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import { parseAbsoluteHttpUrl } from "../validation/fields";
import { assertUploadSlot } from "../validation/upload-slot";
import { assertS3BucketName } from "./bucket";
import { assertPositiveExpiresInSeconds } from "./options";

const S3_METADATA_HEADER_PREFIX = "x-amz-meta-olos-";
const DEFAULT_UPLOAD_GRANT_NOW = () => new Date();

export interface CreateS3UploadGrantOptions {
  additionalHeaders?: Record<string, string>;
  bucket?: string;
  expiresAt?: string;
  presignedUrl: string;
  slot: UploadSlot;
}

export interface CreatePresignedS3UploadGrantOptions {
  additionalHeaders?: Record<string, string>;
  bucket: string;
  client: S3Client;
  clock?: () => Date | string;
  expiresInSeconds: number;
  now?: Date | string;
  slot: UploadSlot;
}

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

  assertPositiveExpiresInSeconds(options.expiresInSeconds);

  const nowMs = resolveNowTimestampMs(options.now, options.clock);

  if (options.slot.state !== "issued") {
    throw new Error("uploadSlot.state must be issued");
  }

  const grantExpiresAt = nowMs + options.expiresInSeconds * 1000;
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
  const headers: Record<string, string> = {
    "x-amz-meta-olos-epoch": String(slot.epoch),
    "x-amz-meta-olos-kind": slot.kind,
    "x-amz-meta-olos-media-sequence-number": String(slot.mediaSequenceNumber),
    "x-amz-meta-olos-rendition-id": slot.renditionId,
    "x-amz-meta-olos-session-id": slot.sessionId,
    "x-amz-meta-olos-slot-id": slot.slotId,
  };

  if (slot.partNumber !== undefined) {
    headers["x-amz-meta-olos-part-number"] = String(slot.partNumber);
  }

  return headers;
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
