import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./script-paths";

describe("TypeScript config", () => {
  test("keeps the root compiler config TypeScript-only and JSX-free", async () => {
    const config = await readFile(join(repoRoot, "tsconfig.json"), "utf8");

    expect(config).not.toContain('"allowJs"');
    expect(config).not.toContain('"jsx"');
  });
});
