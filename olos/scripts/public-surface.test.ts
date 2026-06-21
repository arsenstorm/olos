import { describe, expect, test } from "bun:test";
import packageJson from "../package.json" with { type: "json" };
import {
  packageExportSpecifier,
  packageExportSubpaths,
} from "./package-export-map";
import { expectedRuntimeExports } from "./public-surface";

describe("public package surface manifest", () => {
  test("covers every public package export subpath", () => {
    const exportedSpecifiers = packageExportSubpaths(packageJson.exports)
      .map(packageExportSpecifier)
      .sort();

    expect(Object.keys(expectedRuntimeExports).sort()).toEqual(
      exportedSpecifiers
    );
  });
});
