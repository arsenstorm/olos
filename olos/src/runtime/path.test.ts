import { describe, expect, test } from "bun:test";
import {
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
});
