import { describe, expect, test } from "bun:test";
import { assertNonNegativeInteger, assertPositiveInteger } from "./integers";

describe("state integer assertions", () => {
  test("accepts valid integers", () => {
    expect(() => assertNonNegativeInteger(0, "count")).not.toThrow();
    expect(() => assertPositiveInteger(1, "count")).not.toThrow();
  });

  test("rejects invalid integers", () => {
    expect(() => assertNonNegativeInteger(-1, "count")).toThrow(
      "count must be a non-negative integer"
    );
    expect(() => assertNonNegativeInteger(1.5, "count")).toThrow(
      "count must be a non-negative integer"
    );
    expect(() => assertPositiveInteger(0, "count")).toThrow(
      "count must be a positive integer"
    );
  });
});
