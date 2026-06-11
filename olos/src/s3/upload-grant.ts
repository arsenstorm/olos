import { createUploadGrant } from "../state/upload-grant";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";

export interface CreateS3UploadGrantOptions {
  additionalHeaders?: Record<string, string>;
  expiresAt?: string;
  presignedUrl: string;
  slot: UploadSlot;
}

export function createS3UploadGrant(
  options: CreateS3UploadGrantOptions
): UploadGrant {
  return createUploadGrant({
    additionalHeaders: options.additionalHeaders,
    expiresAt: options.expiresAt,
    slot: options.slot,
    url: options.presignedUrl,
  });
}
