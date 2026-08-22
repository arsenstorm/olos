/**
 * URL-safe identifier (`[A-Za-z0-9._-]+`) used for sessions, tracks,
 * slots, and commits. Enforced by `assertUrlSafeIdentifier`
 * (olos/validation).
 */
export type OlosId = string;

/**
 * Monotonic session generation counter; bumped when the coordinator resets
 * the timeline (a break between generations).
 */
export type Epoch = number;
/**
 * Non-negative position of a segment within a track's timeline. Sequence
 * numbers are monotonic per track; profiles may give them further meaning
 * (for example HLS media sequence numbers aligned across tracks).
 */
export type SequenceNumber = number;
/** Non-negative index of a part within a sequence position. */
export type PartNumber = number;
