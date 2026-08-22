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

test("serializes Date completion timestamps as ISO strings", () => {
  const defaults = createCompletionHintDefaults({
    completionHintNow: () => new Date("2026-01-01T00:00:01.000Z"),
  });

  expect(defaults.committedAt()).toBe("2026-01-01T00:00:01.000Z");
});
