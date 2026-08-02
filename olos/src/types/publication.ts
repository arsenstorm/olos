import type { OlosId } from "./ids";

/**
 * The public delivery address of a committed media object — what a
 * publication step (promotion, read-gate registration) works from.
 */
export interface ObjectPublication {
  commitId: OlosId;
  deliveryUrl: string;
  objectKey: string;
  slotId: OlosId;
}
