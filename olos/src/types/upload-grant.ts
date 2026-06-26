import type { OlosId } from "./ids";

export interface UploadGrant {
  expiresAt: string;
  method: "PUT";
  requiredHeaders?: Record<string, string>;
  slotId: OlosId;
  url: string;
}
