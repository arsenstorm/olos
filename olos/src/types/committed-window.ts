import type { Byterange } from "./byterange";
import type { OlosId, PartNumber, SequenceNumber } from "./ids";
import type { ProfileData } from "./profile";

/**
 * A committed object as it appears inside a `CommittedWindow`: the
 * addressing a consumer needs, plus the commit's profile data, without the
 * full commit envelope.
 */
export interface CommittedObject {
  commitId: OlosId;
  contentType?: string;
  deliveryUrl: string;
  etag?: string;
  objectKey: string;
  /** Profile data copied from the commit (opaque to Core). */
  profile?: ProfileData;
  slotId: OlosId;
}

/**
 * A committed part. `byterange` is set when the part is a byte range of a
 * virtual segment rather than a standalone object.
 */
export type CommittedPart = CommittedObject & {
  byterange?: Byterange;
  partNumber: PartNumber;
};

/**
 * One sequence position in a track window. Carries the full segment
 * object, its parts, or both — a position that only has parts so far (the
 * segment is still being produced) is valid.
 */
export interface CommittedSegment {
  parts?: CommittedPart[];
  segment?: CommittedObject;
  sequenceNumber: SequenceNumber;
}

/**
 * The sliding window of committed objects across all tracks — the
 * authoritative input for anything that renders the stream. Sequence
 * numbers are monotonic within each track, and the first/last bounds span
 * every track window.
 */
export interface CommittedWindow {
  epoch: number;
  firstSequenceNumber: SequenceNumber;
  lastSequenceNumber: SequenceNumber;
  tracks: Record<string, TrackWindow>;
}

/** One track's slice of the committed window. */
export interface TrackWindow {
  /** The track's initialization object, when one has been committed. */
  init?: CommittedObject;
  /**
   * Profile-defined summary of this track window (opaque to Core), as
   * produced by the `trackWindowProfile` hook of `createCommittedWindow`.
   */
  profile?: ProfileData;
  segments: CommittedSegment[];
  trackId: OlosId;
}
