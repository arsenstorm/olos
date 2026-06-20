import { describe, expect, test } from "bun:test";
import {
  createCoordinatorStateWithCommittedSegment,
  createEmptyCoordinatorState,
  testCoordinatorSession,
} from "../protocol/coordinator-state.test-helper";
import {
  serveBlockingCoordinatorManifest,
  serveCoordinatorManifest,
} from "./manifest";

const MEDIA_ORIGIN = "https://media.example.com";

describe("runtime manifest adapter", () => {
  test("serves a coordinator media playlist as a web response", async () => {
    const response = serveCoordinatorManifest({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: testCoordinatorSession.partTarget,
      request: "/v1/live/session_1/v1080/media.m3u8",
      segmentTarget: testCoordinatorSession.segmentTarget,
      state: createCoordinatorStateWithCommittedSegment(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.apple.mpegurl"
    );
    expect(await response.text()).toContain(
      "https://media.example.com/s3810.m4s"
    );
  });

  test("returns not found before the coordinator has a cursor", async () => {
    const response = serveCoordinatorManifest({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: testCoordinatorSession.partTarget,
      request: "/v1/live/session_1/v1080/media.m3u8",
      segmentTarget: testCoordinatorSession.segmentTarget,
      state: createEmptyCoordinatorState(),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("manifest not found");
  });

  test("serves blocking reloads through the current coordinator cursor", async () => {
    const response = await serveBlockingCoordinatorManifest({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: testCoordinatorSession.partTarget,
      request: new Request(
        "https://edge.example.com/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3810"
      ),
      segmentTarget: testCoordinatorSession.segmentTarget,
      state: createCoordinatorStateWithCommittedSegment(),
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("#EXT-X-MEDIA-SEQUENCE:3810");
  });
});
