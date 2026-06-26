import type { OlosId } from "./ids";
import type { PublicationMode } from "./upload-slot";

export interface ObjectPublication {
  commitId: OlosId;
  deliveryUrl: string;
  objectKey: string;
  providerId: OlosId;
  publicationMode: PublicationMode;
  slotId: OlosId;
}
