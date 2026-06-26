import { describe, expect, test } from "bun:test";
import { isStringLiteral } from "./string-literals";

describe("isStringLiteral", () => {
  test("accepts values from the allowed string set", () => {
    expect(isStringLiteral("live", ["created", "live"] as const)).toBe(true);
  });

  test("rejects values outside the allowed string set", () => {
    expect(isStringLiteral("ended", ["created", "live"] as const)).toBe(false);
  });
});
