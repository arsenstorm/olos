import type {
  LATENCY_PROFILES,
  RENDITION_KINDS,
  SESSION_STATES,
} from "../config/session";
import type { Epoch, OlosId } from "./ids";

/** Latency profile a session runs under; currently only `object-ll`. */
export type LatencyProfile = (typeof LATENCY_PROFILES)[number];
/** Media kind of a rendition: `audio`, `video`, `text`, or `metadata`. */
export type RenditionKind = (typeof RENDITION_KINDS)[number];
/**
 * Session lifecycle state. `ended` and `aborted` are terminal and put
 * `EXT-X-ENDLIST` on media playlists.
 */
export type SessionState = (typeof SESSION_STATES)[number];

/**
 * One encoded variant of the session's media. The audio-group fields
 * (`groupId`, `name`, `defaultRendition`) are only valid on audio
 * renditions; `assertSession` (olos/validation) also enforces that grouped
 * audio shares a single group with at most one default.
 */
export interface Rendition {
  bitrate?: number;
  channels?: number;
  codec: string;
  /** Marks the default rendition of an audio group. Audio renditions only. */
  defaultRendition?: boolean;
  frameRate?: number;
  /** HLS audio group membership (EXT-X-MEDIA GROUP-ID). Audio renditions only. */
  groupId?: OlosId;
  height?: number;
  kind: RenditionKind;
  /** Human-readable EXT-X-MEDIA NAME. Audio renditions only. */
  name?: string;
  renditionId: OlosId;
  sampleRate?: number;
  width?: number;
}

/**
 * A live streaming session: identity, lifecycle state, timing targets, and
 * the renditions being published. Validated by `assertSession`
 * (olos/validation).
 */
export interface Session {
  /** ISO 8601 timestamp of session creation. */
  createdAt: string;
  epoch: Epoch;
  latencyProfile: LatencyProfile;
  olos: "1.0";
  /** Target part duration in seconds. */
  partTarget: number;
  renditions: Rendition[];
  /** Target segment duration in seconds. */
  segmentTarget: number;
  sessionId: OlosId;
  state: SessionState;
}
