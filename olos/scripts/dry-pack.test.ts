import { describe, expect, test } from "bun:test";
import { assertDryPackIncludesRequiredFiles } from "./dry-pack";

describe("dry package verifier", () => {
  test("accepts dry pack output with package entrypoints", () => {
    expect(() =>
      assertDryPackIncludesRequiredFiles(
        [
          "packed dist/index.js",
          "packed dist/index.d.ts",
          "packed dist/s3.js",
        ].join("\n")
      )
    ).not.toThrow();
  });

  test("rejects dry pack output without dist entrypoints", () => {
    expect(() =>
      assertDryPackIncludesRequiredFiles(
        ["packed package.json", "packed README.md"].join("\n")
      )
    ).toThrow("dry package is missing dist/index.js");
  });
});
