import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveWorkspaceBin } from "./script-bin";
import { withTemporaryDirectory } from "./test-temp-dir";

describe("script binary resolver", () => {
  test("uses the first root containing the binary", async () => {
    await withTemporaryDirectory("olos-script-bin-", async (root) => {
      const firstRoot = join(root, "package");
      const secondRoot = join(root, "workspace");
      const firstTsc = await writeBin(firstRoot, "tsc");

      await writeBin(secondRoot, "tsc");

      await expect(
        resolveWorkspaceBin("tsc", [firstRoot, secondRoot])
      ).resolves.toBe(firstTsc);
    });
  });

  test("falls back to later roots", async () => {
    await withTemporaryDirectory("olos-script-bin-", async (root) => {
      const firstRoot = join(root, "package");
      const secondRoot = join(root, "workspace");
      const workspaceTsc = await writeBin(secondRoot, "tsc");

      await expect(
        resolveWorkspaceBin("tsc", [firstRoot, secondRoot])
      ).resolves.toBe(workspaceTsc);
    });
  });

  test("rejects missing binaries with context", async () => {
    await withTemporaryDirectory("olos-script-bin-", async (root) => {
      await expect(resolveWorkspaceBin("tsc", [root])).rejects.toThrow(
        "tsc binary not found in package or workspace node_modules"
      );
    });
  });
});

async function writeBin(root: string, name: string): Promise<string> {
  const path = join(root, "node_modules", ".bin", name);

  await mkdir(join(root, "node_modules", ".bin"), { recursive: true });
  await writeFile(path, "");

  return path;
}
