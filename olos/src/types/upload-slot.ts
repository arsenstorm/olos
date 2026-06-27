import type { PUBLICATION_MODES } from "../config/publication";
import type { UPLOAD_SLOT_STATES } from "../config/upload-slot";
import type { Byterange } from "./byterange";
import type { Epoch, MediaSequenceNumber, OlosId, PartNumber } from "./ids";
import type { MediaObjectKind } from "./media-object";

export type PublicationMode = (typeof PUBLICATION_MODES)[number];
export type UploadSlotState = (typeof UPLOAD_SLOT_STATES)[number];

export interface UploadSlot {
  byterange?: Byterange;
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
  publisherInstanceId: OlosId;
  renditionId: OlosId;
  sessionId: OlosId;
  slotId: OlosId;
  state: UploadSlotState;
  tenantId: OlosId;
}
