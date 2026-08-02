import { describe, expect, test } from "bun:test";
import { DEFAULT_SESSION_PATH } from "../runtime/route";
import {
  S3_ROUTE_ACTIONS,
  S3_SESSION_ROUTE_SEGMENT,
  s3CompletionHintRoutePath,
  s3CompletionHintRoutePathFromOptions,
  s3RoutePath,
  s3RoutePathFromOptions,
} from "./route";

describe("S3 route path builders", () => {
  test("builds S3 session route paths", () => {
    expect(s3RoutePathFromOptions("session_1", S3_ROUTE_ACTIONS.commits)).toBe(
      "/sessions/session_1/s3/commits"
    );
    expect(
      s3RoutePathFromOptions("session_1", S3_ROUTE_ACTIONS.commits, {
        sessionPath: "custom",
      })
    ).toBe("/custom/session_1/s3/commits");
    expect(
      s3RoutePath(DEFAULT_SESSION_PATH, "session_1", S3_ROUTE_ACTIONS.commits)
    ).toBe("/sessions/session_1/s3/commits");

    expect(
      s3CompletionHintRoutePath(DEFAULT_SESSION_PATH, "session_1", "slot 1")
    ).toBe("/sessions/session_1/upload-slots/slot%201/complete");
    expect(s3CompletionHintRoutePathFromOptions("session_1", "slot 1")).toBe(
      "/sessions/session_1/upload-slots/slot%201/complete"
    );
    expect(
      s3CompletionHintRoutePathFromOptions("session_1", "slot 1", {
        sessionPath: "custom",
      })
    ).toBe("/custom/session_1/upload-slots/slot%201/complete");
  });

  test("exposes S3 route segment constants", () => {
    expect(S3_SESSION_ROUTE_SEGMENT).toBe("s3");
  });
});
