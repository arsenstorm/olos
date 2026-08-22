import type { CommittedWindow } from "./committed-window";
import type { Epoch, OlosId, PartNumber, SequenceNumber } from "./ids";
import type { StreamProfile } from "./profile";
import type { SessionState } from "./session";

/**
 * The session's published state: everything a delivery edge needs to render
 * the stream without consulting the coordinator. A new cursor is produced on
 * every commit; consumers treat it as immutable.
 */
export interface Cursor {
  committedWindow: CommittedWindow;
  /** Base URL that relative delivery URLs in the window resolve against. */
  deliveryBaseUrl: string;
  epoch: Epoch;
  olos: "1.0";
  /** The session's profile, copied unchanged from the session. */
  profile: StreamProfile;
  sessionId: OlosId;
  state: SessionState;
  /** ISO 8601 timestamp of the commit that produced this cursor. */
  updatedAt: string;
  window: CursorWindow;
}

/**
 * Compact sequence bounds of the committed window, used for cheap
 * "has anything new landed" comparisons (for example HLS blocking reload).
 */
export interface CursorWindow {
  firstSequenceNumber: SequenceNumber;
  /** Highest committed part number within the last sequence position. */
  lastPartNumber?: PartNumber;
  lastSequenceNumber: SequenceNumber;
}
