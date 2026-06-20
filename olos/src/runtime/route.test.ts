import { describe, expect, test } from "bun:test";
import { routeIdentifierError, routeParts } from "./route";

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
