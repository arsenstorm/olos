import type { CommittedWindow } from "./committed-window";
import type { Epoch, MediaSequenceNumber, OlosId, PartNumber } from "./ids";
import type { LatencyProfile, SessionState } from "./session";

/**
 * The session's published playback state: everything a delivery edge needs
 * to render playlists without consulting the coordinator. A new cursor is
 * produced on every commit; consumers treat it as immutable.
 */
export interface Cursor {
  committedWindow: CommittedWindow;
  epoch: Epoch;
  latencyProfile: LatencyProfile;
  /** Base URL that relative delivery URLs in the window resolve against. */
  mediaBaseUrl: string;
  olos: "1.0";
  /** Target part duration in seconds (EXT-X-PART-INF PART-TARGET). */
  partTarget: number;
  /** Target segment duration in seconds (EXT-X-TARGETDURATION source). */
  segmentTarget: number;
  sessionId: OlosId;
  state: SessionState;
  /** ISO 8601 timestamp of the commit that produced this cursor. */
  updatedAt: string;
  window: CursorWindow;
}

/**
 * Compact sequence bounds of the committed window, used for blocking
 * playlist reload (`_HLS_msn` / `_HLS_part`) comparisons.
 */
export interface CursorWindow {
  firstMediaSequenceNumber: MediaSequenceNumber;
  lastMediaSequenceNumber: MediaSequenceNumber;
  /** Highest committed part number within the last media sequence. */
  lastPartNumber?: PartNumber;
}
