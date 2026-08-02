/**
 * URL-safe identifier (`[A-Za-z0-9._-]+`) used for sessions, renditions,
 * slots, and commits. Enforced by `assertUrlSafeIdentifier`
 * (olos/validation).
 */
export type OlosId = string;

/**
 * Monotonic session generation counter; bumped when the coordinator resets
 * the timeline (a discontinuity between generations).
 */
export type Epoch = number;
/** Non-negative HLS media sequence number of a segment position. */
export type MediaSequenceNumber = number;
/** Non-negative LL-HLS part index within a media sequence position. */
export type PartNumber = number;
