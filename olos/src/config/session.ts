/**
 * Session lifecycle states. `ended` and `aborted` are terminal; media
 * playlists gain `EXT-X-ENDLIST` once the session reaches a terminal state.
 * `SessionState` (olos/types) is the derived union type.
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

/**
 * Latency profiles a session can run under. Currently only `object-ll`
 * (object-store low latency). `LatencyProfile` (olos/types) is the derived
 * union type.
 */
export const LATENCY_PROFILES = ["object-ll"] as const;

/**
 * Media kinds a session rendition can carry. `RenditionKind` (olos/types)
 * is the derived union type.
 */
export const RENDITION_KINDS = ["audio", "video", "text", "metadata"] as const;
