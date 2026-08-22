import { describe, expect, test } from "bun:test";
import {
  S3_ROUTE_ACTIONS,
  S3_SESSION_ROUTE_SEGMENT,
  s3CompletionHintRoutePath,
  s3RoutePath,
} from "./route";

describe("S3 route path builders", () => {
  test("builds S3 session route paths", () => {
    expect(s3RoutePath("session_1", S3_ROUTE_ACTIONS.commits)).toBe(
      "/sessions/session_1/s3/commits"
    );

    expect(s3CompletionHintRoutePath("session_1", "slot 1")).toBe(
      "/sessions/session_1/upload-slots/slot%201/complete"
    );
  });

  test("exposes S3 route segment constants", () => {
    expect(S3_SESSION_ROUTE_SEGMENT).toBe("s3");
  });
});
