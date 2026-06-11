import type { CommittedWindow } from "./committed-window";
import type { Epoch, MediaSequenceNumber, OlosId, PartNumber } from "./ids";
import type { Pathway } from "./pathway";
import type { LatencyProfile, SessionState } from "./session";

export interface Cursor {
  committedWindow: CommittedWindow;
  epoch: Epoch;
  latencyProfile: LatencyProfile;
  olos: "1.0";
  partTarget: number;
  pathways: Pathway[];
  segmentTarget: number;
  sessionId: OlosId;
  state: SessionState;
  tenantId: OlosId;
  updatedAt: string;
  window: CursorWindow;
}

export interface CursorWindow {
  firstMediaSequenceNumber: MediaSequenceNumber;
  lastMediaSequenceNumber: MediaSequenceNumber;
  lastPartNumber?: PartNumber;
}
