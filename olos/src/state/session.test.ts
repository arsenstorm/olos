import { describe, expect, test } from "bun:test";

import { assertSessionTransition, canTransitionSession } from "./session";

describe("session transitions", () => {
  test("allows spec-defined transitions", () => {
    expect(canTransitionSession("live", "ending")).toBe(true);
    expect(canTransitionSession("ending", "ended")).toBe(true);
    expect(canTransitionSession("live", "aborted")).toBe(true);
  });

  test("rejects unspecified transitions", () => {
    expect(canTransitionSession("ended", "live")).toBe(false);
    expect(canTransitionSession("aborted", "live")).toBe(false);
    expect(canTransitionSession("ending", "live")).toBe(false);
  });

  test("rejects terminal states without outgoing transitions", () => {
    expect(canTransitionSession("ended", "ended")).toBe(false);
  });

  test("throws for invalid transitions", () => {
    expect(() => assertSessionTransition("ended", "live")).toThrow(
      "Invalid session transition: ended -> live"
    );
  });
});
