import type { Byterange } from "./byterange";
import type { Epoch, MediaSequenceNumber, OlosId, PartNumber } from "./ids";

export interface Commit {
  byterange?: Byterange;
  commitId: OlosId;
  committedAt: string;
  deliveryUrl: string;
  duration: number;
  epoch: Epoch;
  etag?: string;
  independent?: boolean;
  mediaSequenceNumber: MediaSequenceNumber;
  objectKey: string;
  partNumber?: PartNumber;
  programDateTime?: string;
  renditionId: OlosId;
  sessionId: OlosId;
  size: number;
  slotId: OlosId;
}
