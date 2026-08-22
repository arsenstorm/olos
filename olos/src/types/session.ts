import type { Epoch, OlosId } from "./ids";
import type { ProfileData, StreamProfile } from "./profile";

/**
 * Wire format version carried in the `olos` field of sessions, cursors, and
 * provider capability documents. Validators reject documents whose `olos`
 * field does not match this value.
 */
export const OLOS_WIRE_VERSION = "1.0";

/**
 * Session lifecycle states. `ended` and `aborted` are terminal: no further
 * slots are issued and profiles mark the stream as complete (for example
 * `EXT-X-ENDLIST` in HLS). `SessionState` (olos/types) is the derived union
 * type.
 */
export const SESSION_STATES = ["live", "ending", "ended", "aborted"] as const;

/**
 * Allowed session state transitions, keyed by current state. States absent
 * from the map (`ended`, `aborted`) are terminal. Enforced by
 * `canTransitionSession` / `assertSessionTransition` (olos/state).
 */
export const SESSION_TRANSITIONS = {
  ending: ["ended"],
  live: ["ending", "aborted"],
} as const;

/** Session lifecycle state; `ended` and `aborted` are terminal. */
export type SessionState = (typeof SESSION_STATES)[number];

/**
 * One ordered stream of objects within a session. Core only identifies the
 * track; what the objects contain (encoding, schema, dimensions, ...) is
 * profile data.
 */
export interface Track {
  /** Default content type of the track's objects, when uniform. */
  contentType?: string;
  /** Profile-defined description of the track (opaque to Core). */
  profile?: ProfileData;
  trackId: OlosId;
}

/**
 * A live object streaming session: identity, lifecycle state, the profile
 * it runs under, and the tracks being published. Validated by
 * `assertSession` (olos/validation).
 */
export interface Session {
  /** ISO 8601 timestamp of session creation. */
  createdAt: string;
  epoch: Epoch;
  olos: "1.0";
  /** Profile the session runs under; copied unchanged onto cursors. */
  profile: StreamProfile;
  sessionId: OlosId;
  state: SessionState;
  tracks: Track[];
}
