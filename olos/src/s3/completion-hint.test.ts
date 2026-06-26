import { expect, test } from "bun:test";
import { createCompletionHintDefaults } from "./completion-hint";

test("uses the default completion-hint commitId prefix", () => {
  const defaults = createCompletionHintDefaults({});

  expect(defaults.commitId("slot_1")).toBe("complete_slot_1");
});

test("uses completionHintNow when committedAt is omitted", () => {
  const committedAt = "2026-01-01T00:00:01.000Z";

  const defaults = createCompletionHintDefaults({
    completionHintNow: () => committedAt,
  });

  expect(defaults.committedAt()).toBe(committedAt);
});

test("serializes Date completion clocks as ISO timestamps", () => {
  const defaults = createCompletionHintDefaults({
    completionHintClock: () => new Date("2026-01-01T00:00:01.000Z"),
  });

  expect(defaults.committedAt()).toBe("2026-01-01T00:00:01.000Z");
});

test("prefers completionHintClock over completionHintNow", () => {
  const committedAt = "2026-01-01T00:00:01.000Z";

  const defaults = createCompletionHintDefaults({
    completionHintClock: () => committedAt,
    completionHintNow: () => "2026-01-01T00:00:02.000Z",
  });

  expect(defaults.committedAt()).toBe(committedAt);
});
