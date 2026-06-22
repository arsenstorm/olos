import { describe, expect, test } from "bun:test";

import {
  assertNonNegativeInteger,
  assertNonNegativeSafeInteger,
  assertPositiveInteger,
  assertPositiveSafeInteger,
  assertUrlSafeIdentifier,
  isNonNegativeInteger,
  isNonNegativeSafeInteger,
  isPositiveInteger,
  isPositiveSafeInteger,
  isUrlSafeIdentifier,
} from "./ids";

describe("identifier validation", () => {
  test("accepts non-negative integers", () => {
    expect(isNonNegativeInteger(0)).toBe(true);
    expect(isNonNegativeInteger(3812)).toBe(true);
    expect(isPositiveInteger(1)).toBe(true);
    expect(isPositiveInteger(3812)).toBe(true);
    expect(isNonNegativeSafeInteger(0)).toBe(true);
    expect(isPositiveSafeInteger(1)).toBe(true);
  });

  test("rejects invalid non-negative integers", () => {
    expect(isNonNegativeInteger(-1)).toBe(false);
    expect(isNonNegativeInteger(1.5)).toBe(false);
    expect(isNonNegativeInteger("1")).toBe(false);
    expect(isPositiveInteger(0)).toBe(false);
    expect(isPositiveInteger(1.5)).toBe(false);
    expect(isPositiveInteger("1")).toBe(false);
    expect(isNonNegativeSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isPositiveSafeInteger(0)).toBe(false);
    expect(isPositiveSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });

  test("throws for invalid non-negative integers", () => {
    expect(() => assertNonNegativeInteger(-1, "partNumber")).toThrow(
      "partNumber must be a non-negative integer"
    );
    expect(() => assertPositiveInteger(0, "count")).toThrow(
      "count must be a positive integer"
    );
    expect(() =>
      assertNonNegativeSafeInteger(Number.MAX_SAFE_INTEGER + 1, "partNumber")
    ).toThrow("partNumber must be a non-negative integer");
    expect(() =>
      assertPositiveSafeInteger(Number.MAX_SAFE_INTEGER + 1, "count")
    ).toThrow("count must be a positive integer");
    expect(() => assertPositiveSafeInteger(0, "count")).toThrow(
      "count must be a positive integer"
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
