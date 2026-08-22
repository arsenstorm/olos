import type { OlosId } from "./ids";

/**
 * How uploaded media objects become publicly readable: `direct-public`
 * (uploads land on the public origin), `read-gated` (a read gate checks
 * commit state per request), or `private-upload-public-promotion` (objects
 * are copied/promoted after commit). `PublicationMode` (olos/types) is the
 * derived union type.
 */
export const PUBLICATION_MODES = [
  "direct-public",
  "read-gated",
  "private-upload-public-promotion",
] as const;

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
