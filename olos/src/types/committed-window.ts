import type { Byterange } from "./byterange";
import type { MediaSequenceNumber, OlosId, PartNumber } from "./ids";

/**
 * A committed media object as it appears inside a `CommittedWindow`: the
 * addressing and playback metadata manifests need, without the full commit
 * envelope.
 */
export interface CommittedObject {
  commitId: OlosId;
  contentType?: string;
  deliveryUrl: string;
  duration?: number;
  etag?: string;
  objectKey: string;
  slotId: OlosId;
}

/**
 * A committed LL-HLS partial segment. `byterange` is set when the part is a
 * byte range of a virtual segment rather than a standalone object.
 */
export type CommittedPart = CommittedObject & {
  byterange?: Byterange;
  duration: number;
  independent?: boolean;
  partNumber: PartNumber;
  programDateTime?: string;
};

/**
 * One media sequence position in a rendition window. Carries the full
 * segment object, its parts, or both — a position that only has parts so
 * far (the segment is still being produced) is valid.
 */
export interface CommittedSegment {
  /** Emit `EXT-X-DISCONTINUITY` before this segment. */
  discontinuityBefore?: boolean;
  duration: number;
  independent?: boolean;
  mediaSequenceNumber: MediaSequenceNumber;
  parts?: CommittedPart[];
  programDateTime?: string;
  segment?: CommittedObject;
}

/**
 * The sliding window of committed media across all renditions — the
 * authoritative input for rendering media playlists. Sequence numbers are
 * monotonic within each rendition, and the first/last bounds apply to every
 * rendition window.
 */
export interface CommittedWindow {
  /** Value for `EXT-X-DISCONTINUITY-SEQUENCE`. */
  discontinuitySequence: number;
  epoch: number;
  firstMediaSequenceNumber: MediaSequenceNumber;
  lastMediaSequenceNumber: MediaSequenceNumber;
  renditions: Record<string, RenditionWindow>;
}

/** One rendition's slice of the committed window. */
export interface RenditionWindow {
  init: CommittedObject;
  renditionId: OlosId;
  segments: CommittedSegment[];
}
