import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import packageJson from "../package.json" with { type: "json" };
import {
  packageExportSpecifier,
  packageExportSubpaths,
} from "./package-export-map";
import { writePackageSmokeFile } from "./package-smoke-fixture";
import {
  packageTypeSmokeConfig,
  packageTypeSmokeSource,
} from "./package-smoke-types";
import { expectedRuntimeExports } from "./public-surface";
import { withTemporaryDirectory } from "./test-temp-dir";

const README_IMPORT_PATTERN =
  /import\s+(type\s+)?\{\s*([^;]*?)\s*\}\s+from\s+["'](olos(?:\/[a-z-]+)?)["'];/g;
const README_TYPESCRIPT_BLOCK_PATTERN = /```ts\n([\s\S]*?)\n```/g;
const IMPORT_ALIAS_PATTERN = /\s+as\s+/;

type ReadmeImportKind = "runtime" | "type";

describe("package smoke fixture", () => {
  test("keeps README code fences balanced", () => {
    const readme = readmeSource();
    const fences = [...readme.matchAll(/^```/gm)];

    expect(fences.length % 2).toBe(0);
  });

  test("covers README runtime import examples", () => {
    const documented = readmeRuntimeImports();
    const missing = new Map<string, string[]>();

    for (const [specifier, names] of documented) {
      const covered = new Set(
        expectedRuntimeExports[specifier as keyof typeof expectedRuntimeExports]
      );
      const missingNames = names.filter((name) => !covered.has(name));

      if (missingNames.length > 0) {
        missing.set(specifier, missingNames);
      }
    }

    expect(Object.fromEntries(missing)).toEqual({});
  });

  test("covers README type import examples", async () => {
    const documented = readmeTypeImports();

    await withTemporaryDirectory(
      "olos-package-smoke-fixture-",
      async (root) => {
        await writePackageSmokeFile(root);

        const typeSmoke = await readFile(
          new URL("smoke.ts", `file://${root}/`),
          {
            encoding: "utf8",
          }
        );
        const missing = new Map<string, string[]>();

        for (const [specifier, names] of documented) {
          const missingNames = names.filter(
            (name) =>
              !(
                typeSmoke.includes("import type {") &&
                typeSmoke.includes(`} from "${specifier}";`) &&
                typeSmoke.includes(name)
              )
          );

          if (missingNames.length > 0) {
            missing.set(specifier, missingNames);
          }
        }

        expect(Object.fromEntries(missing)).toEqual({});
      }
    );
  });

  test("keeps runtime smoke specifiers aligned with package exports", () => {
    expect(Object.keys(expectedRuntimeExports).sort()).toEqual(
      packageExportSpecifiers()
    );
  });

  test("emits a strict NodeNext type smoke config", () => {
    expect(JSON.parse(packageTypeSmokeConfig())).toEqual({
      compilerOptions: {
        lib: ["ES2022", "DOM"],
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: "ES2022",
        types: [],
      },
      include: ["smoke.ts"],
    });
  });

  test("emits type smoke sections in dependency order", () => {
    const source = packageTypeSmokeSource();

    expect(
      source.indexOf('import { OLOS_WIRE_VERSION } from "olos";')
    ).toBeLessThan(
      source.indexOf("const profile = createRuntimeObjectLowLatencyProfile();")
    );
    expect(
      source.indexOf("const profile = createRuntimeObjectLowLatencyProfile();")
    ).toBeLessThan(source.indexOf("const session: Session = {"));
    expect(source.indexOf("const s3PublisherSummary")).toBeLessThan(
      source.indexOf("if (!grant.requiredHeaders)")
    );
  });
});

function packageExportSpecifiers(): string[] {
  return packageExportSubpaths(packageJson.exports)
    .map(packageExportSpecifier)
    .sort();
}

function readmeRuntimeImports(): Map<string, string[]> {
  return readmeImports("runtime");
}

function readmeTypeImports(): Map<string, string[]> {
  return readmeImports("type");
}

function readmeImports(kind: ReadmeImportKind): Map<string, string[]> {
  const readme = readmeSource();
  const imports = new Map<string, Set<string>>();

  for (const block of readme.matchAll(README_TYPESCRIPT_BLOCK_PATTERN)) {
    const [, source] = block;

    for (const match of source.matchAll(README_IMPORT_PATTERN)) {
      const [, typeOnly, rawNames, specifier] = match;

      if (!shouldCollectReadmeImport(kind, typeOnly, specifier)) {
        continue;
      }

      addReadmeImportNames(
        imports,
        specifier,
        readmeImportNames(rawNames, kind)
      );
    }
  }

  return new Map(
    [...imports].map(([specifier, names]) => [specifier, [...names].sort()])
  );
}

function shouldCollectReadmeImport(
  kind: ReadmeImportKind,
  typeOnly: string | undefined,
  specifier: string
): boolean {
  if (kind === "runtime") {
    return typeOnly === undefined && specifier !== "olos/types";
  }

  return typeOnly !== undefined;
}

function readmeImportNames(rawNames: string, kind: ReadmeImportKind): string[] {
  return rawNames
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => name.split(IMPORT_ALIAS_PATTERN)[0]?.trim() ?? "")
    .filter(
      (name) =>
        name.length > 0 && (kind === "type" || !name.startsWith("type "))
    );
}

function addReadmeImportNames(
  imports: Map<string, Set<string>>,
  specifier: string,
  names: readonly string[]
): void {
  if (!imports.has(specifier)) {
    imports.set(specifier, new Set());
  }

  const existing = imports.get(specifier);

  if (existing === undefined) {
    throw new Error(`missing import set for ${specifier}`);
  }

  for (const name of names) {
    existing.add(name);
  }
}

function readmeSource(): string {
  return readFileSync(new URL("../README.md", import.meta.url), "utf8");
}
