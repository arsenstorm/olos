import { describe, expect, test } from "bun:test";
import { planCoordinatorRetention } from "./coordinator-lifecycle";
import { createEmptyCoordinatorState } from "./coordinator-state.test-helper";

describe("coordinator lifecycle helpers", () => {
  test("plans retention without retained objects before a cursor exists", () => {
    expect(
      planCoordinatorRetention({
        now: "2026-01-01T00:00:06.000Z",
        state: createEmptyCoordinatorState(),
      })
    ).toEqual({
      expiredSlots: [],
      retiredObjects: [],
    });
  });
});
