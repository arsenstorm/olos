import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
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
});

async function listTestFiles(root: string): Promise<string[]> {
  const testFiles: string[] = [];
  const pending = [join(root, "scripts"), join(root, "src")];

  while (pending.length > 0) {
    const current = pending.pop();

    if (current === undefined) {
      continue;
    }

    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);

      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        testFiles.push(path);
      }
    }
  }

  return testFiles.sort();
}
