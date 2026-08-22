import type { Byterange } from "./byterange";
import type { Epoch, OlosId, PartNumber, SequenceNumber } from "./ids";
import type { ProfileData } from "./profile";

/**
 * The record that makes an uploaded object part of the published stream. A
 * commit binds an observed upload to its slot; committing is what advances
 * the session's cursor and exposes the object in the committed window.
 */
export interface Commit {
  /** Only present on part commits; forbidden on segment and init commits. */
  byterange?: Byterange;
  commitId: OlosId;
  /** ISO 8601 timestamp of when the commit was accepted. */
  committedAt: string;
  deliveryUrl: string;
  epoch: Epoch;
  /** Object-store ETag of the uploaded object, when observed. */
  etag?: string;
  objectKey: string;
  /** Present on part commits; absent on segment and init commits. */
  partNumber?: PartNumber;
  /** Profile-defined facts about the object (opaque to Core). */
  profile?: ProfileData;
  sequenceNumber: SequenceNumber;
  sessionId: OlosId;
  /** Uploaded object size in bytes. */
  size: number;
  slotId: OlosId;
  trackId: OlosId;
}
