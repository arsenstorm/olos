import { describe, expect, test } from "bun:test";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import {
  packageExportEntrypoint,
  packageExportSubpaths,
} from "./package-export-map";
import { packageRoot } from "./script-paths";

const EXPORT_SOURCE_PATTERN = /from\s+"([^"]+)";/g;

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
    for (const entrypoint of publicFacadeEntrypoints()) {
      await access(sourceFacadePath(entrypoint));
    }
  });

  test("only have source facade files for public subpaths", async () => {
    const sourceEntries = await readdir(join(packageRoot, "src"), {
      withFileTypes: true,
    });
    const expectedFacadeEntrypoints = publicFacadeEntrypoints();
    const actualFacadeEntrypoints = sourceEntries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".test.ts")
      )
      .map((entry) => entry.name.slice(0, -".ts".length))
      .sort();

    expect(actualFacadeEntrypoints).toEqual(expectedFacadeEntrypoints);
  });

  test("keep public facade export blocks grouped by source module", async () => {
    for (const entrypoint of publicFacadeEntrypoints()) {
      const source = await readFile(sourceFacadePath(entrypoint), "utf8");
      const exportSources = [...source.matchAll(EXPORT_SOURCE_PATTERN)].map(
        (match) => match[1]
      );

      expect(exportSources).toEqual([...exportSources].sort());
    }
  });

  test("maps the root package export to the index facade", () => {
    expect(sourceFacadePath("index")).toBe(
      join(packageRoot, "src", "index.ts")
    );
  });
});

function publicFacadeEntrypoints(): string[] {
  return packageExportSubpaths(packageJson.exports)
    .map(packageExportEntrypoint)
    .sort();
}

function sourceFacadePath(entrypoint: string): string {
  return join(packageRoot, "src", `${entrypoint}.ts`);
}
