import type { Epoch, MediaSequenceNumber, OlosId, PartNumber } from "./ids";
import type { MediaObjectKind } from "./media-object";

export type PublicationMode =
  | "direct-public"
  | "read-gated"
  | "private-upload-public-promotion";

export type UploadSlotState =
  | "issued"
  | "upload_observed"
  | "committed"
  | "announced"
  | "expired"
  | "rejected"
  | "revoked";

export interface UploadSlot {
  contentType: string;
  deliveryUrl: string;
  duration: number;
  epoch: Epoch;
  expiresAt: string;
  kind: MediaObjectKind;
  maxBytes: number;
  mediaSequenceNumber: MediaSequenceNumber;
  minBytes?: number;
  objectKey: string;
  partNumber?: PartNumber;
  publicationMode: PublicationMode;
  publisherInstanceId: OlosId;
  renditionId: OlosId;
  sessionId: OlosId;
  slotId: OlosId;
  state: UploadSlotState;
  tenantId: OlosId;
}
