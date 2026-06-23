import { describe, expect, test } from "bun:test";
import { packageSmokeSource } from "./package-smoke-runtime";

describe("package runtime smoke fixture", () => {
  test("emits named package export subpath helpers", () => {
    const source = packageSmokeSource();

    expect(source).toContain(".filter(isPackageModuleExportSubpath)");
    expect(source).toContain(".map(packageExportSpecifier)");
    expect(source).toContain('return subpath !== "./package.json";');
  });
});
