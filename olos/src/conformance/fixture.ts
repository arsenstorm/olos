import type { Session } from "../types/session";

/** Media base URL used by every conformance harness session. */
export const CONFORMANCE_MEDIA_BASE_URL = "https://media.example.com";

/** A minimal live session with one 1080p video rendition. */
export const CONFORMANCE_SESSION: Session = {
  createdAt: "2026-01-01T00:00:00.000Z",
  epoch: 1,
  latencyProfile: "object-ll",
  olos: "1.0",
  partTarget: 0.5,
  renditions: [
    {
      bitrate: 5_000_000,
      codec: "avc1.640028",
      frameRate: 30,
      height: 1080,
      kind: "video",
      renditionId: "v1080",
      width: 1920,
    },
  ],
  segmentTarget: 2,
  sessionId: "session_1",
  state: "live",
};
