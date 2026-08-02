import type { Byterange } from "./byterange";
import type { Epoch, MediaSequenceNumber, OlosId, PartNumber } from "./ids";

/**
 * The record that makes an uploaded media object part of the published
 * stream. A commit binds an observed upload to its slot; committing is what
 * advances the session's cursor and exposes the object in manifests.
 */
export interface Commit {
  /** Only present on part commits; forbidden on segment and init commits. */
  byterange?: Byterange;
  commitId: OlosId;
  /** ISO 8601 timestamp of when the commit was accepted. */
  committedAt: string;
  deliveryUrl: string;
  /** Media duration in seconds. */
  duration: number;
  epoch: Epoch;
  /** Object-store ETag of the uploaded object, when observed. */
  etag?: string;
  /** Marks a part that starts with an independent (key) frame. */
  independent?: boolean;
  mediaSequenceNumber: MediaSequenceNumber;
  objectKey: string;
  /** Present on part commits; absent on segment and init commits. */
  partNumber?: PartNumber;
  /** ISO 8601 wall-clock time of the media (EXT-X-PROGRAM-DATE-TIME). */
  programDateTime?: string;
  renditionId: OlosId;
  sessionId: OlosId;
  /** Uploaded object size in bytes. */
  size: number;
  slotId: OlosId;
}
