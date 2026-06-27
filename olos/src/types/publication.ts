import type { OlosId } from "./ids";
import type { PublicationMode } from "./upload-slot";

export interface ObjectPublication {
  commitId: OlosId;
  deliveryUrl: string;
  objectKey: string;
  publicationMode: PublicationMode;
  slotId: OlosId;
}
