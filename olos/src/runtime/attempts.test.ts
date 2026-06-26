import { describe, expect, test } from "bun:test";
import { positiveAttempts } from "./attempts";

describe("runtime attempt helpers", () => {
  test("defaults to two attempts", () => {
    expect(positiveAttempts(undefined)).toBe(2);
  });

  test("accepts explicit positive attempts", () => {
    expect(positiveAttempts(3)).toBe(3);
  });

  test("rejects invalid attempt counts", () => {
    expect(() => positiveAttempts(-1)).toThrow(
      "maxAttempts must be a positive integer"
    );
    expect(() => positiveAttempts(0)).toThrow(
      "maxAttempts must be a positive integer"
    );
    expect(() => positiveAttempts(1.5)).toThrow(
      "maxAttempts must be a positive integer"
    );
  });
});
