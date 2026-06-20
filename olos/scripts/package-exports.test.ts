import { describe, expect, test } from "bun:test";
import { access } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { packageRoot } from "./script-paths";

describe("package exports", () => {
  test("map package subpaths to matching dist entrypoints", () => {
    for (const [subpath, value] of Object.entries(packageJson.exports)) {
      if (subpath === "./package.json") {
        expect(value).toBe("./package.json");
        continue;
      }

      const entrypoint = packageExportEntrypoint(subpath);

      expect(value).toEqual({
        default: `./dist/${entrypoint}.js`,
        import: `./dist/${entrypoint}.js`,
        types: `./dist/${entrypoint}.d.ts`,
      });
    }
  });

  test("have matching source facade files for public subpaths", async () => {
    for (const subpath of Object.keys(packageJson.exports)) {
      if (subpath === "./package.json") {
        continue;
      }

      await access(
        join(packageRoot, "src", `${packageExportEntrypoint(subpath)}.ts`)
      );
    }
  });
});

function packageExportEntrypoint(subpath: string): string {
  return subpath === "." ? "index" : subpath.slice("./".length);
}
