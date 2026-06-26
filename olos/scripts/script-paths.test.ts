import { expect, test } from "bun:test";
import { access } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { packageRoot, repoRoot } from "./script-paths";

test("script paths identify the package and repository roots", async () => {
  expect(basename(packageRoot)).toBe("olos");
  expect(dirname(packageRoot)).toBe(repoRoot);

  await access(join(packageRoot, "package.json"));
  await access(join(repoRoot, "README.md"));
});
