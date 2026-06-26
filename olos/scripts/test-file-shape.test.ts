import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { listDirectoryEntries } from "./directory-walk";
import { packageRoot } from "./script-paths";

const TEST_DECLARATION_PATTERN = /\b(?:describe|it|test)\(/;

describe("test file shape", () => {
  test("discovers script test files", async () => {
    expect(await listTestFiles(packageRoot)).toContain(
      join(packageRoot, "scripts", "test-file-shape.test.ts")
    );
  });

  test("keeps test files from being helper-only modules", async () => {
    expect(await listHelperOnlyTestFiles(packageRoot)).toEqual([]);
  });

  test("keeps helper test files in canonical naming", async () => {
    expect(await listMisnamedHelperTestFiles(packageRoot)).toEqual([]);
  });

  test("keeps test helper modules out of test discovery", async () => {
    expect(await listDiscoverableTestHelperModules(packageRoot)).toEqual([]);
  });
});

async function listHelperOnlyTestFiles(root: string): Promise<string[]> {
  const testFiles = await listTestFiles(root);
  const helperOnlyTestFiles = await Promise.all(
    testFiles.map(async (file) =>
      (await hasTestDeclaration(file)) ? undefined : packageRelativePath(file)
    )
  );

  return helperOnlyTestFiles.filter(isDefined).sort();
}

async function listMisnamedHelperTestFiles(root: string): Promise<string[]> {
  return (await listTestFiles(root))
    .filter(isMisnamedHelperTestFile)
    .map(packageRelativePath)
    .sort();
}

async function listDiscoverableTestHelperModules(
  root: string
): Promise<string[]> {
  return (await listSourceFiles(root))
    .filter(isDiscoverableTestHelperModule)
    .map(packageRelativePath)
    .sort();
}

async function listTestFiles(root: string): Promise<string[]> {
  const sourceFiles = await listSourceFiles(root);

  return sourceFiles.filter((file) => file.endsWith(".test.ts"));
}

async function hasTestDeclaration(file: string): Promise<boolean> {
  return TEST_DECLARATION_PATTERN.test(await readFile(file, "utf8"));
}

function packageRelativePath(path: string): string {
  return relative(packageRoot, path);
}

function isMisnamedHelperTestFile(path: string): boolean {
  return path.endsWith("-helper.test.ts") && !isCanonicalHelperTestFile(path);
}

function isTestHelperModule(path: string): boolean {
  return path.endsWith(".test-helper.ts") && !isCanonicalHelperTestFile(path);
}

function isDiscoverableTestHelperModule(path: string): boolean {
  return isTestHelperModule(path) && path.endsWith(".test.ts");
}

function isCanonicalHelperTestFile(path: string): boolean {
  return path.endsWith(".test-helper.test.ts");
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

async function listSourceFiles(root: string): Promise<string[]> {
  const roots = [join(root, "scripts"), join(root, "src")];
  const sourceFiles = await Promise.all(
    roots.map(async (directory) =>
      (await listDirectoryEntries(directory))
        .filter((entry) => entry.isFile && entry.relativePath.endsWith(".ts"))
        .map((entry) => entry.absolutePath)
    )
  );

  return sourceFiles.flat().sort();
}
