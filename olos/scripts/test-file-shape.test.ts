import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { listDirectoryEntries } from "./directory-walk";
import { packageRoot } from "./script-paths";

const TEST_DECLARATION_PATTERN = /\b(?:describe|it|test)\(/;

describe("test file shape", () => {
  test("keeps test files from being helper-only modules", async () => {
    const testFiles = await listTestFiles(packageRoot);
    const helperOnlyTestFiles: string[] = [];

    for (const file of testFiles) {
      const source = await readFile(file, "utf8");

      if (!TEST_DECLARATION_PATTERN.test(source)) {
        helperOnlyTestFiles.push(relative(packageRoot, file));
      }
    }

    expect(helperOnlyTestFiles).toEqual([]);
  });

  test("keeps helper test files in canonical naming", async () => {
    const testFiles = await listTestFiles(packageRoot);
    const badHelperTestFiles: string[] = [];

    for (const file of testFiles) {
      if (
        file.endsWith("-helper.test.ts") &&
        !file.endsWith(".test-helper.test.ts")
      ) {
        badHelperTestFiles.push(relative(packageRoot, file));
      }
    }

    expect(badHelperTestFiles).toEqual([]);
  });

  test("keeps test helper modules out of test discovery", async () => {
    const sourceFiles = await listSourceFiles(packageRoot);
    const badHelperModules = sourceFiles
      .filter(
        (file) =>
          file.endsWith(".test-helper.ts") &&
          !file.endsWith(".test-helper.test.ts")
      )
      .filter((file) => file.endsWith(".test.ts"));

    expect(badHelperModules).toEqual([]);
  });
});

async function listTestFiles(root: string): Promise<string[]> {
  const sourceFiles = await listSourceFiles(root);

  return sourceFiles.filter((file) => file.endsWith(".test.ts"));
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
