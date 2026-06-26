import { describe, expect, test } from "bun:test";
import { packageSmokeSource } from "./package-smoke-runtime";

describe("package runtime smoke fixture", () => {
  test("emits named package export subpath helpers", () => {
    const source = packageSmokeSource();

    expect(source).toContain(".filter(isPackageModuleExportSubpath)");
    expect(source).toContain(".map(packageExportSpecifier)");
    expect(source).toContain('return subpath !== "./package.json";');
  });

  test("emits runtime smoke sections in dependency order", () => {
    const source = packageSmokeSource();

    expect(
      source.indexOf('import { readFile } from "node:fs/promises";')
    ).toBeLessThan(source.indexOf("const packageJson = JSON.parse("));
    expect(source.indexOf('assertList("exported subpaths"')).toBeLessThan(
      source.indexOf("for (const [specifier, names]")
    );
    expect(source.indexOf("for (const [specifier, names]")).toBeLessThan(
      source.indexOf("function assertList")
    );
  });
});
