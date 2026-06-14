import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertInstalledPackageContents } from "./package-contents";

describe("package contents verifier", () => {
  test("accepts the intended package root", async () => {
    const root = await createPackageRoot();

    await writeFile(join(root, "dist", "index.js"), "");
    await writeFile(join(root, "dist", "index.d.ts"), "");

    await expect(assertInstalledPackageContents(root)).resolves.toBeUndefined();
  });

  test("rejects private source roots", async () => {
    const root = await createPackageRoot();

    await mkdir(join(root, "live"));
    await writeFile(join(root, "live", "s3.test.ts"), "");

    await expect(assertInstalledPackageContents(root)).rejects.toThrow(
      "package root entries mismatch"
    );
  });

  test("rejects test files inside published roots", async () => {
    const root = await createPackageRoot();

    await writeFile(join(root, "dist", "index.test.js"), "");

    await expect(assertInstalledPackageContents(root)).rejects.toThrow(
      "package contains private file: dist/index.test.js"
    );
  });

  test("rejects test declarations inside published roots", async () => {
    const root = await createPackageRoot();

    await writeFile(join(root, "dist", "index.test.d.ts"), "");

    await expect(assertInstalledPackageContents(root)).rejects.toThrow(
      "package contains private file: dist/index.test.d.ts"
    );
  });

  test("rejects spec files inside published roots", async () => {
    const root = await createPackageRoot();

    await writeFile(join(root, "dist", "index.spec.js"), "");

    await expect(assertInstalledPackageContents(root)).rejects.toThrow(
      "package contains private file: dist/index.spec.js"
    );
  });
});

async function createPackageRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "olos-package-contents-"));

  await mkdir(join(root, "dist"));
  await writeFile(join(root, "LICENSE"), "");
  await writeFile(join(root, "README.md"), "");
  await writeFile(join(root, "package.json"), "{}\n");

  return root;
}
