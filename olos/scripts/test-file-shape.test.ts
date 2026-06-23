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
    const testFiles = await listTestFiles(packageRoot);
    const helperOnlyTestFiles: string[] = [];

    for (const file of testFiles) {
      const source = await readFile(file, "utf8");

      if (!TEST_DECLARATION_PATTERN.test(source)) {
        helperOnlyTestFiles.push(packageRelativePath(file));
      }
    }

    expect(helperOnlyTestFiles).toEqual([]);
  });

  test("keeps helper test files in canonical naming", async () => {
    const testFiles = await listTestFiles(packageRoot);
    const badHelperTestFiles: string[] = [];

    for (const file of testFiles) {
      if (isMisnamedHelperTestFile(file)) {
        badHelperTestFiles.push(packageRelativePath(file));
      }
    }

    expect(badHelperTestFiles).toEqual([]);
  });

  test("keeps test helper modules out of test discovery", async () => {
    const sourceFiles = await listSourceFiles(packageRoot);
    const badHelperModules = sourceFiles
      .filter(isTestHelperModule)
      .filter((file) => file.endsWith(".test.ts"));

    expect(badHelperModules).toEqual([]);
  });
});

async function listTestFiles(root: string): Promise<string[]> {
  const sourceFiles = await listSourceFiles(root);

  return sourceFiles.filter((file) => file.endsWith(".test.ts"));
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

function isCanonicalHelperTestFile(path: string): boolean {
  return path.endsWith(".test-helper.test.ts");
}

async function listSourceFiles(root: string): Promise<string[]> {
  const roots = [join(root, "scripts"), join(root, "src")];
  const testFiles = await Promise.all(
    roots.map(async (directory) =>
      (await listDirectoryEntries(directory))
        .filter((entry) => entry.isFile && entry.relativePath.endsWith(".ts"))
        .map((entry) => entry.absolutePath)
    )
  );

  return testFiles.flat().sort();
}
