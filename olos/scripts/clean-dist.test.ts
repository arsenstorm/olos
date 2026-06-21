import { expect, test } from "bun:test";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanDist } from "./clean-dist";

test("cleanDist removes a dist directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "olos-clean-dist-"));
  const dist = join(root, "dist");
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, "marker.txt"), "keep");

  await cleanDist(dist);

  await expect(stat(dist)).rejects.toThrow();
});

test("cleanDist is safe when directory is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "olos-clean-dist-missing-"));
  const dist = join(root, "dist");

  await expect(cleanDist(dist)).resolves.toBeUndefined();
});
