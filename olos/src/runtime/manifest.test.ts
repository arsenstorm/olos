import { describe, expect, test } from "bun:test";
import {
  createCoordinatorStateWithCommittedSegment,
  createEmptyCoordinatorState,
  testCoordinatorSession,
} from "../protocol/coordinator-state.test-helper";
import type { CoordinatorPipelineState } from "../protocol/coordinator-types";
import {
  serveBlockingCoordinatorManifest,
  serveCoordinatorManifest,
} from "./manifest";

const MEDIA_ORIGIN = "https://media.example.com";

function createEndedCoordinatorState(): CoordinatorPipelineState {
  const state = createCoordinatorStateWithCommittedSegment();

  if (state.cursor === undefined) {
    throw new Error("expected committed coordinator cursor");
  }

  return {
    ...state,
    cursor: { ...state.cursor, state: "ended" },
    session: { ...state.session, state: "ended" },
  };
}

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
      "https://media.example.com/media/v1080/s3810.m4s"
    );
  });

  test("ends served media playlists once the session has ended", async () => {
    const response = serveCoordinatorManifest({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: testCoordinatorSession.partTarget,
      request: "/v1/live/session_1/v1080/media.m3u8",
      segmentTarget: testCoordinatorSession.segmentTarget,
      state: createEndedCoordinatorState(),
    });

    expect(response.status).toBe(200);
    const playlist = await response.text();
    expect(playlist.endsWith("\n#EXT-X-ENDLIST\n")).toBe(true);
  });

  test("keeps served media playlists open while the session is live", async () => {
    const response = serveCoordinatorManifest({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: testCoordinatorSession.partTarget,
      request: "/v1/live/session_1/v1080/media.m3u8",
      segmentTarget: testCoordinatorSession.segmentTarget,
      state: createCoordinatorStateWithCommittedSegment(),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("#EXT-X-ENDLIST");
  });

  test("serves coordinator manifests from Request objects", async () => {
    const response = serveCoordinatorManifest({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: testCoordinatorSession.partTarget,
      request: new Request(
        "https://edge.example.com/v1/live/session_1/master.m3u8"
      ),
      segmentTarget: testCoordinatorSession.segmentTarget,
      state: createCoordinatorStateWithCommittedSegment(),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      "/v1/live/session_1/v1080/media.m3u8"
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

  test("applies response cache options to blocking manifests", async () => {
    const response = await serveBlockingCoordinatorManifest({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: testCoordinatorSession.partTarget,
      request: "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3810",
      response: {
        maxAgeSeconds: 0,
        targetLatencySeconds: 3,
      },
      segmentTarget: testCoordinatorSession.segmentTarget,
      state: createCoordinatorStateWithCommittedSegment(),
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate"
    );
  });

  test("returns not found for blocking reloads before the coordinator has a cursor", async () => {
    const response = await serveBlockingCoordinatorManifest({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: testCoordinatorSession.partTarget,
      request: "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3810&_HLS_part=0",
      segmentTarget: testCoordinatorSession.segmentTarget,
      state: createEmptyCoordinatorState(),
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("manifest not found");
  });

  test("returns not found for unknown blocking manifest paths", async () => {
    const response = await serveBlockingCoordinatorManifest({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: testCoordinatorSession.partTarget,
      request: "/v1/live/session_1/missing.m3u8?_HLS_msn=3810",
      segmentTarget: testCoordinatorSession.segmentTarget,
      state: createCoordinatorStateWithCommittedSegment(),
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("manifest not found");
  });

  test("rejects master-path directives and unknown paths without waiting", async () => {
    let waiterCalls = 0;
    const waitForCursor = () => {
      waiterCalls += 1;
      return Promise.reject(new Error("waiter should not be called"));
    };

    const invalid = await serveBlockingCoordinatorManifest({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: testCoordinatorSession.partTarget,
      request: "/v1/live/session_1/master.m3u8?_HLS_msn=3810",
      segmentTarget: testCoordinatorSession.segmentTarget,
      state: createCoordinatorStateWithCommittedSegment(),
      timeoutMs: 3_600_000,
      waitForCursor,
    });

    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toBe(
      "_HLS_msn/_HLS_part apply to media playlist requests"
    );

    const notFound = await serveBlockingCoordinatorManifest({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: testCoordinatorSession.partTarget,
      request: "/v1/live/session_1/bogus.m3u8?_HLS_msn=9999",
      segmentTarget: testCoordinatorSession.segmentTarget,
      state: createCoordinatorStateWithCommittedSegment(),
      timeoutMs: 3_600_000,
      waitForCursor,
    });

    expect(notFound.status).toBe(404);
    expect(await notFound.text()).toBe("manifest not found");
    expect(waiterCalls).toBe(0);
  });

  test("returns invalid responses for malformed blocking reload requests", async () => {
    const response = await serveBlockingCoordinatorManifest({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: testCoordinatorSession.partTarget,
      request: "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=bad",
      segmentTarget: testCoordinatorSession.segmentTarget,
      state: createCoordinatorStateWithCommittedSegment(),
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "_HLS_msn must be a non-negative integer"
    );
  });
});
