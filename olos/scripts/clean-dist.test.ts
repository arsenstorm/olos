import { expect, test } from "bun:test";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanDist } from "./clean-dist";
import { withTemporaryDirectory } from "./test-temp-dir";

test("cleanDist removes a dist directory", async () => {
  await withTemporaryDirectory("olos-clean-dist-", async (root) => {
    const dist = join(root, "dist");
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, "marker.txt"), "keep");

    await cleanDist(dist);

    await expect(stat(dist)).rejects.toThrow();
  });
});

test("cleanDist is safe when directory is absent", async () => {
  await withTemporaryDirectory("olos-clean-dist-missing-", async (root) => {
    const dist = join(root, "dist");

    await expect(cleanDist(dist)).resolves.toBeUndefined();
  });
});
