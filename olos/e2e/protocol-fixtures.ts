import { createRuntimeObjectLowLatencyProfile } from "@arsenstorm/olos/runtime";
import type { Session } from "@arsenstorm/olos/types";

const latency = createRuntimeObjectLowLatencyProfile();

export const TEST_MEDIA_BASE_URL = "https://media.example.com";

export interface TestSessionOptions {
  state?: Session["state"];
}

export function createTestSession(options: TestSessionOptions = {}): Session {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    epoch: 1,
    latencyProfile: latency.latencyProfile,
    olos: "1.0",
    partTarget: latency.partTarget,
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
    segmentTarget: latency.segmentTarget,
    sessionId: "session_1",
    state: options.state ?? "live",
    tenantId: "tenant_1",
  };
}
