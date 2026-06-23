import { describe, expect, test } from "bun:test";
import {
  assertSafePath,
  assertSafePathSegment,
  normalizedSafeRelativePath,
  trimSlashes,
  trimTrailingSlash,
} from "./path";

describe("runtime path helpers", () => {
  test("trimSlashes removes leading and trailing slashes", () => {
    expect(trimSlashes("/v1/live/")).toBe("v1/live");
    expect(trimSlashes("///v1/live///")).toBe("v1/live");
    expect(trimSlashes("v1/live")).toBe("v1/live");
  });

  test("trimTrailingSlash preserves leading slashes", () => {
    expect(trimTrailingSlash("/v1/live/")).toBe("/v1/live");
    expect(trimTrailingSlash("/")).toBe("");
    expect(trimTrailingSlash("v1/live")).toBe("v1/live");
  });

  test("normalizedSafeRelativePath trims outer slashes", () => {
    expect(normalizedSafeRelativePath("v1/live", "path")).toBe("v1/live");
    expect(normalizedSafeRelativePath("/v1/live/", "path")).toBe("v1/live");
  });

  test("normalizedSafeRelativePath rejects unsafe values", () => {
    const unsafeValues = [
      "",
      "/",
      "//live",
      "../live",
      "v1/../live",
      "https://evil.test/live",
      "v1/live?token=abc",
      "v1/live#fragment",
      "v1/live\n",
    ];

    for (const value of unsafeValues) {
      expect(() => normalizedSafeRelativePath(value, "path")).toThrow(
        "path must be a safe relative path"
      );
    }
  });

  test("assertSafePath rejects unsafe values", () => {
    expect(() => assertSafePath("", "path")).toThrow(
      "path must be a safe relative path"
    );
    expect(() => assertSafePath("/v1/live", "path")).toThrow(
      "path must be a safe relative path"
    );
    expect(() => assertSafePath("v1/live/", "path")).toThrow(
      "path must be a safe relative path"
    );
    expect(() => assertSafePath("v1//live", "path")).toThrow(
      "path must be a safe relative path"
    );
    expect(() => assertSafePath("../live", "path")).toThrow(
      "path must be a safe relative path"
    );
    expect(() => assertSafePath("v1/live?x=1", "path")).toThrow(
      "path must not contain query strings or fragments"
    );
    expect(() => assertSafePath("v1/live#fragment", "path")).toThrow(
      "path must not contain query strings or fragments"
    );
  });

  test("assertSafePathSegment rejects unsafe values", () => {
    expect(() => assertSafePathSegment("", "segment")).toThrow(
      "segment must be a safe path segment without dots"
    );
    expect(() => assertSafePathSegment("foo/bar", "segment")).toThrow(
      "segment must be a safe path segment without dots"
    );
    expect(() => assertSafePathSegment("foo.bar", "segment")).toThrow(
      "segment must be a safe path segment without dots"
    );
  });
});
