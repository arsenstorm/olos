import type { OlosId } from "./ids";

export interface ObjectPublication {
  commitId: OlosId;
  deliveryUrl: string;
  objectKey: string;
  slotId: OlosId;
}
