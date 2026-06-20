import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { listDirectoryEntries } from "./directory-walk";
import { withTemporaryDirectory } from "./test-temp-dir";

describe("directory walker", () => {
  test("lists descendant files and directories with stable relative paths", async () => {
    await withTemporaryDirectory("olos-directory-walk-", async (root) => {
      await mkdir(join(root, "src", "runtime"), { recursive: true });
      await writeFile(join(root, "README.md"), "");
      await writeFile(join(root, "src", "runtime", "client.test.ts"), "");

      const entries = await listDirectoryEntries(root);

      expect(
        entries.map((entry) => ({
          isDirectory: entry.isDirectory,
          isFile: entry.isFile,
          relativePath: entry.relativePath,
        }))
      ).toEqual([
        { isDirectory: false, isFile: true, relativePath: "README.md" },
        { isDirectory: true, isFile: false, relativePath: "src" },
        { isDirectory: true, isFile: false, relativePath: "src/runtime" },
        {
          isDirectory: false,
          isFile: true,
          relativePath: "src/runtime/client.test.ts",
        },
      ]);
    });
  });
});
