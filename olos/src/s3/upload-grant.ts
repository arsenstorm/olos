import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createUploadGrant } from "../state/upload-grant";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";

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
  expiresInSeconds: number;
  now?: Date | string;
  slot: UploadSlot;
}

export function createS3UploadGrant(
  options: CreateS3UploadGrantOptions
): UploadGrant {
  assertPresignedUrlMatchesSlot(options);

  return createUploadGrant({
    additionalHeaders: options.additionalHeaders,
    expiresAt: options.expiresAt,
    slot: options.slot,
    url: options.presignedUrl,
  });
}

function assertPresignedUrlMatchesSlot(
  options: CreateS3UploadGrantOptions
): void {
  const pathSegments = pathParts(new URL(options.presignedUrl).pathname);
  const keySegments = pathParts(options.slot.objectKey);

  if (
    pathSegments.join("/") === keySegments.join("/") ||
    (options.bucket !== undefined &&
      pathSegments[0] === options.bucket &&
      pathSegments.slice(1).join("/") === keySegments.join("/"))
  ) {
    return;
  }

  throw new Error("presignedUrl path must match uploadSlot.objectKey");
}

function pathParts(value: string): string[] {
  return value.split("/").filter(Boolean);
}

export async function createPresignedS3UploadGrant(
  options: CreatePresignedS3UploadGrantOptions
): Promise<UploadGrant> {
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

function createRequiredHeaders(
  options: CreatePresignedS3UploadGrantOptions
): Record<string, string> {
  return {
    "Content-Type": options.slot.contentType,
    "If-None-Match": "*",
    "x-olos-slot-id": options.slot.slotId,
    ...options.additionalHeaders,
  };
}

function expiresAt(options: CreatePresignedS3UploadGrantOptions): string {
  const nowMs =
    options.now === undefined ? Date.now() : new Date(options.now).getTime();

  return new Date(nowMs + options.expiresInSeconds * 1000).toISOString();
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
