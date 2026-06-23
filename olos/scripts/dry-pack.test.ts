import { describe, expect, test } from "bun:test";
import {
  assertDryPackIncludesRequiredFiles,
  requiredDryPackFilesFromExports,
} from "./dry-pack";

describe("dry package verifier", () => {
  test("accepts dry pack output with package entrypoints", () => {
    expect(() =>
      assertDryPackIncludesRequiredFiles(
        [
          "packed dist/index.js",
          "packed dist/index.d.ts",
          "packed dist/config.js",
          "packed dist/config.d.ts",
          "packed dist/conformance.js",
          "packed dist/conformance.d.ts",
          "packed dist/hls.js",
          "packed dist/hls.d.ts",
          "packed dist/protocol.js",
          "packed dist/protocol.d.ts",
          "packed dist/runtime.js",
          "packed dist/runtime.d.ts",
          "packed dist/schema.js",
          "packed dist/schema.d.ts",
          "packed dist/s3.js",
          "packed dist/s3.d.ts",
          "packed dist/state.js",
          "packed dist/state.d.ts",
          "packed dist/types.js",
          "packed dist/types.d.ts",
          "packed dist/validation.js",
          "packed dist/validation.d.ts",
        ].join("\n")
      )
    ).not.toThrow();
  });

  test("rejects dry pack output without dist entrypoints", () => {
    expect(() =>
      assertDryPackIncludesRequiredFiles(
        ["packed package.json", "packed README.md"].join("\n")
      )
    ).toThrow("dry package is missing dist/");
  });

  test("derives required files from package exports", () => {
    expect(
      requiredDryPackFilesFromExports({
        ".": {
          import: "./dist/index.js",
          types: "./dist/index.d.ts",
        },
        "./package.json": "./package.json",
        "./runtime": {
          default: "./dist/runtime-default.js",
          import: "./dist/runtime.js",
          types: "./dist/runtime.d.ts",
        },
      })
    ).toEqual([
      "dist/index.d.ts",
      "dist/index.js",
      "dist/runtime-default.js",
      "dist/runtime.d.ts",
      "dist/runtime.js",
    ]);
  });

  test("deduplicates repeated package export files", () => {
    expect(
      requiredDryPackFilesFromExports({
        ".": {
          default: "./dist/index.js",
          import: "./dist/index.js",
          types: "./dist/index.d.ts",
        },
      })
    ).toEqual(["dist/index.d.ts", "dist/index.js"]);
  });
});
