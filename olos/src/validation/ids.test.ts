import { describe, expect, test } from "bun:test";

import {
  assertNonNegativeInteger,
  assertUrlSafeIdentifier,
  isNonNegativeInteger,
  isUrlSafeIdentifier,
} from "./ids";

describe("identifier validation", () => {
  test("accepts non-negative integers", () => {
    expect(isNonNegativeInteger(0)).toBe(true);
    expect(isNonNegativeInteger(3812)).toBe(true);
  });

  test("rejects invalid non-negative integers", () => {
    expect(isNonNegativeInteger(-1)).toBe(false);
    expect(isNonNegativeInteger(1.5)).toBe(false);
    expect(isNonNegativeInteger("1")).toBe(false);
  });

  test("throws for invalid non-negative integers", () => {
    expect(() => assertNonNegativeInteger(-1, "partNumber")).toThrow(
      "partNumber must be a non-negative integer"
    );
  });

  test("accepts URL-safe identifiers", () => {
    expect(isUrlSafeIdentifier("sess_01JZLIVE")).toBe(true);
    expect(isUrlSafeIdentifier("r2-primary")).toBe(true);
    expect(isUrlSafeIdentifier("tenant.acme")).toBe(true);
  });

  test("rejects unsafe identifiers", () => {
    expect(isUrlSafeIdentifier("")).toBe(false);
    expect(isUrlSafeIdentifier("../secret")).toBe(false);
    expect(isUrlSafeIdentifier("https://example.com")).toBe(false);
    expect(isUrlSafeIdentifier("tenant acme")).toBe(false);
  });

  test("throws for unsafe identifiers", () => {
    expect(() => assertUrlSafeIdentifier("../secret", "sessionId")).toThrow(
      "sessionId must be a non-empty URL-safe identifier"
    );
  });
});
