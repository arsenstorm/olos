import type { OlosId } from "./ids";

/**
 * Short-lived permission to upload one object for one slot — typically a
 * presigned PUT URL. Validated by `assertUploadGrant` (olos/validation).
 */
export interface UploadGrant {
  /** ISO 8601 expiry; uploads after this instant are rejected. */
  expiresAt: string;
  method: "PUT";
  /** Headers the uploader must send exactly (they are signature-bound). */
  requiredHeaders?: Record<string, string>;
  slotId: OlosId;
  /** Absolute HTTP(S) upload URL. */
  url: string;
}
