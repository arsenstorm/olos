import type { CommittedWindow } from "./committed-window";
import type { Epoch, MediaSequenceNumber, OlosId, PartNumber } from "./ids";
import type { LatencyProfile, SessionState } from "./session";

export interface Cursor {
  committedWindow: CommittedWindow;
  epoch: Epoch;
  latencyProfile: LatencyProfile;
  mediaBaseUrl: string;
  olos: "1.0";
  partTarget: number;
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
