import type { Byterange } from "./byterange";
import type { MediaSequenceNumber, OlosId, PartNumber } from "./ids";

export interface CommittedObject {
  commitId: OlosId;
  contentType?: string;
  deliveryUrl: string;
  duration?: number;
  etag?: string;
  objectKey: string;
  slotId: OlosId;
}

export type CommittedPart = CommittedObject & {
  byterange?: Byterange;
  duration: number;
  independent?: boolean;
  partNumber: PartNumber;
  programDateTime?: string;
};

export interface CommittedSegment {
  discontinuityBefore?: boolean;
  duration: number;
  independent?: boolean;
  mediaSequenceNumber: MediaSequenceNumber;
  parts?: CommittedPart[];
  programDateTime?: string;
  segment?: CommittedObject;
}

export interface CommittedWindow {
  discontinuitySequence: number;
  epoch: number;
  firstMediaSequenceNumber: MediaSequenceNumber;
  lastMediaSequenceNumber: MediaSequenceNumber;
  renditions: Record<string, RenditionWindow>;
}

export interface RenditionWindow {
  init: CommittedObject;
  renditionId: OlosId;
  segments: CommittedSegment[];
}
