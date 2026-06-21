import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LIVE_PATH,
  DEFAULT_SESSION_PATH,
  liveMasterPath,
  liveMediaPath,
  routeIdentifierError,
  routeParts,
  S3_ROUTE_ACTIONS,
  S3_SESSION_ROUTE_SEGMENT,
  s3CompletionHintRoutePath,
  s3RoutePath,
  sessionRootPath,
  sessionRoutePath,
} from "./route";

describe("routeParts", () => {
  test("returns decoded path parts for matching routes", () => {
    expect(routeParts("/sessions/session_1/slots", "/sessions")).toEqual([
      "session_1",
      "slots",
    ]);
    expect(routeParts("/sessions/session%201/health", "sessions/")).toEqual([
      "session 1",
      "health",
    ]);
  });

  test("returns an empty part list for exact route matches", () => {
    expect(routeParts("/sessions", "/sessions")).toEqual([]);
    expect(routeParts("/sessions/", "/sessions")).toEqual([]);
  });

  test("returns undefined for non-matching route prefixes", () => {
    expect(
      routeParts("/sessions-extra/session_1", "/sessions")
    ).toBeUndefined();
    expect(routeParts("/v1/live/session_1", "/sessions")).toBeUndefined();
  });

  test("returns invalid for malformed percent encoding", () => {
    expect(routeParts("/sessions/%E0%A4%A/health", "/sessions")).toBe(
      "invalid"
    );
  });

  test("formats unsafe route identifier errors", () => {
    expect(
      routeIdentifierError("session_1", "sessionId", "invalid route sessionId")
    ).toBeUndefined();
    expect(
      routeIdentifierError(undefined, "sessionId", "invalid route sessionId")
    ).toBe("sessionId must be a non-empty URL-safe identifier");
    expect(
      routeIdentifierError("../secret", "sessionId", "invalid route sessionId")
    ).toBe("sessionId must be a non-empty URL-safe identifier");
  });
});

describe("route path builders", () => {
  test("normalizes session and live route roots", () => {
    expect(sessionRootPath(DEFAULT_SESSION_PATH)).toBe("/sessions");
    expect(sessionRootPath("sessions")).toBe("/sessions");
    expect(sessionRootPath(DEFAULT_LIVE_PATH)).toBe("/v1/live");
  });

  test("builds runtime session route paths", () => {
    expect(sessionRoutePath(DEFAULT_SESSION_PATH, "session 1", "slots")).toBe(
      "/sessions/session%201/slots"
    );
  });

  test("builds S3 session route paths", () => {
    expect(
      s3RoutePath(DEFAULT_SESSION_PATH, "session_1", S3_ROUTE_ACTIONS.commits)
    ).toBe("/sessions/session_1/s3/commits");

    expect(
      s3CompletionHintRoutePath(DEFAULT_SESSION_PATH, "session_1", "slot 1")
    ).toBe("/sessions/session_1/upload-slots/slot%201/complete");
  });

  test("builds live route paths", () => {
    expect(liveMasterPath(DEFAULT_LIVE_PATH, "session_1")).toBe(
      "/v1/live/session_1/master.m3u8"
    );

    expect(liveMediaPath(DEFAULT_LIVE_PATH, "session_1", "v1080")).toBe(
      "/v1/live/session_1/v1080/media.m3u8"
    );
  });

  test("exposes S3 route segment constants", () => {
    expect(S3_SESSION_ROUTE_SEGMENT).toBe("s3");
  });
});
