import { describe, expect, test } from "bun:test";
import { timestampMs } from "./timestamp";

describe("state timestamp parsing", () => {
  test("returns milliseconds for valid timestamps", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";

    expect(timestampMs(timestamp, "now")).toBe(Date.parse(timestamp));
  });

  test("rejects invalid timestamps", () => {
    expect(() => timestampMs("later", "now")).toThrow(
      "now must be a valid timestamp"
    );
  });
});
