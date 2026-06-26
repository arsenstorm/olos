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
const PACKAGE_METADATA_EXPORT = "./package.json";

describe("package exports", () => {
  test("map package subpaths to matching dist entrypoints", () => {
    for (const [subpath, value] of Object.entries(packageJson.exports)) {
      if (isPackageMetadataExport(subpath)) {
        expect(value).toBe(PACKAGE_METADATA_EXPORT);
        continue;
      }

      expect(value).toEqual(expectedModuleExportValue(subpath));
    }
  });

  test("have matching source facade files for public subpaths", async () => {
    for (const entrypoint of publicModuleEntrypoints()) {
      await access(sourceFacadePath(entrypoint));
    }
  });

  test("only have source facade files for public subpaths", async () => {
    const sourceEntries = await readdir(join(packageRoot, "src"), {
      withFileTypes: true,
    });
    const expectedFacadeEntrypoints = publicModuleEntrypoints();
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
    for (const entrypoint of publicModuleEntrypoints()) {
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

function publicModuleEntrypoints(): string[] {
  return packageExportSubpaths(packageJson.exports)
    .map(packageExportEntrypoint)
    .sort();
}

function isPackageMetadataExport(subpath: string): boolean {
  return subpath === PACKAGE_METADATA_EXPORT;
}

function expectedModuleExportValue(subpath: string): {
  default: string;
  import: string;
  types: string;
} {
  const entrypoint = packageExportEntrypoint(subpath);

  return {
    default: distEntrypointPath(entrypoint, "js"),
    import: distEntrypointPath(entrypoint, "js"),
    types: distEntrypointPath(entrypoint, "d.ts"),
  };
}

function distEntrypointPath(entrypoint: string, extension: string): string {
  return `./dist/${entrypoint}.${extension}`;
}

function sourceFacadePath(entrypoint: string): string {
  return join(packageRoot, "src", `${entrypoint}.ts`);
}
