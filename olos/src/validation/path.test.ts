import { describe, expect, test } from "bun:test";
import { trimSlashes, trimTrailingSlash } from "./path";

describe("validation path trimming", () => {
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
});
