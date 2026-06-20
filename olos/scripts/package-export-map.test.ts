import { describe, expect, test } from "bun:test";
import {
  packageExportEntrypoint,
  packageExportSpecifier,
  packageExportSubpaths,
} from "./package-export-map";

describe("package export map helpers", () => {
  test("maps package subpaths to source and package entrypoints", () => {
    expect(packageExportEntrypoint(".")).toBe("index");
    expect(packageExportEntrypoint("./runtime")).toBe("runtime");
    expect(packageExportSpecifier(".")).toBe("olos");
    expect(packageExportSpecifier("./runtime")).toBe("olos/runtime");
  });

  test("keeps package metadata out of public module subpaths", () => {
    expect(
      packageExportSubpaths({
        ".": {},
        "./package.json": "./package.json",
        "./runtime": {},
      })
    ).toEqual([".", "./runtime"]);
  });
});
