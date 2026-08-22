import {
  createRuntimeObjectLowLatencyProfile,
  type MediaSession,
} from "@arsenstorm/olos/media";
import type { Session } from "@arsenstorm/olos/types";

const latency = createRuntimeObjectLowLatencyProfile();

export const TEST_MEDIA_BASE_URL = "https://media.example.com";

export interface TestSessionOptions {
  state?: Session["state"];
}

export function createTestSession(
  options: TestSessionOptions = {}
): MediaSession {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    epoch: 1,
    olos: "1.0",
    profile: {
      id: "cmaf-llhls",
      partTarget: latency.partTarget,
      segmentTarget: latency.segmentTarget,
    },
    tracks: [
      {
        profile: {
          bitrate: 5_000_000,
          codec: "avc1.640028",
          frameRate: 30,
          height: 1080,
          kind: "video",
          width: 1920,
        },
        trackId: "v1080",
      },
    ],
    sessionId: "session_1",
    state: options.state ?? "live",
  };
}
