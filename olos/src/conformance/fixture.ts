import type { Session } from "../types/session";

/** Delivery base URL used by every conformance harness session. */
export const CONFORMANCE_DELIVERY_BASE_URL = "https://media.example.com";

/** A minimal live session with one track under a profile-agnostic id. */
export const CONFORMANCE_SESSION: Session = {
  createdAt: "2026-01-01T00:00:00.000Z",
  epoch: 1,
  olos: "1.0",
  profile: { id: "conformance" },
  sessionId: "session_1",
  state: "live",
  tracks: [{ trackId: "track_1" }],
};
