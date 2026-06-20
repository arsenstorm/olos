import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertInstalledPackageContents } from "./package-contents";
import { withTemporaryDirectory } from "./test-temp-dir";

const privatePackageRoots = ["e2e", "fixtures", "live", "scripts", "src"];

describe("package contents verifier", () => {
  test("accepts the intended package root", async () => {
    await withPackageRoot(async (root) => {
      await writeFile(join(root, "dist", "index.js"), "");
      await writeFile(join(root, "dist", "index.d.ts"), "");

      await expect(
        assertInstalledPackageContents(root)
      ).resolves.toBeUndefined();
    });
  });

  for (const privateRoot of privatePackageRoots) {
    test(`rejects private ${privateRoot} roots`, async () => {
      await withPackageRoot(async (root) => {
        await mkdir(join(root, privateRoot));
        await writeFile(join(root, privateRoot, "fixture.txt"), "");

        await expect(assertInstalledPackageContents(root)).rejects.toThrow(
          "package root entries mismatch"
        );
      });
    });
  }

  test("rejects test files inside published roots", async () => {
    await withPackageRoot(async (root) => {
      await writeFile(join(root, "dist", "index.test.js"), "");

      await expect(assertInstalledPackageContents(root)).rejects.toThrow(
        "package contains private file: dist/index.test.js"
      );
    });
  });

  test("rejects test declarations inside published roots", async () => {
    await withPackageRoot(async (root) => {
      await writeFile(join(root, "dist", "index.test.d.ts"), "");

      await expect(assertInstalledPackageContents(root)).rejects.toThrow(
        "package contains private file: dist/index.test.d.ts"
      );
    });
  });

  test("rejects test helper files inside published roots", async () => {
    await withPackageRoot(async (root) => {
      await writeFile(join(root, "dist", "test-client.test-helper.js"), "");

      await expect(assertInstalledPackageContents(root)).rejects.toThrow(
        "package contains private file: dist/test-client.test-helper.js"
      );
    });
  });

  test("rejects test helper declarations inside published roots", async () => {
    await withPackageRoot(async (root) => {
      await writeFile(join(root, "dist", "test-client.test-helper.d.ts"), "");

      await expect(assertInstalledPackageContents(root)).rejects.toThrow(
        "package contains private file: dist/test-client.test-helper.d.ts"
      );
    });
  });

  test("rejects spec files inside published roots", async () => {
    await withPackageRoot(async (root) => {
      await writeFile(join(root, "dist", "index.spec.js"), "");

      await expect(assertInstalledPackageContents(root)).rejects.toThrow(
        "package contains private file: dist/index.spec.js"
      );
    });
  });

  test("rejects TypeScript config files inside published roots", async () => {
    await withPackageRoot(async (root) => {
      await writeFile(join(root, "dist", "tsconfig.build.json"), "{}\n");

      await expect(assertInstalledPackageContents(root)).rejects.toThrow(
        "package contains private file: dist/tsconfig.build.json"
      );
    });
  });
});

async function withPackageRoot(
  run: (root: string) => Promise<void>
): Promise<void> {
  await withTemporaryDirectory("olos-package-contents-", async (root) => {
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "LICENSE"), "");
    await writeFile(join(root, "README.md"), "");
    await writeFile(join(root, "package.json"), "{}\n");

    await run(root);
  });
}
