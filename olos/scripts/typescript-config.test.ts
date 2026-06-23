import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./script-paths";

describe("TypeScript config", () => {
  test("keeps the root compiler config TypeScript-only and JSX-free", async () => {
    const config = await rootTypeScriptConfigSource();

    expect(config).not.toContain('"allowJs"');
    expect(config).not.toContain('"jsx"');
  });

  test("enables focused unused-code checks before index-signature cleanup", async () => {
    const config = await rootTypeScriptConfigSource();

    expect(config).toContain('"noUnusedLocals": true');
    expect(config).toContain('"noUnusedParameters": true');
    expect(config).toContain('"noPropertyAccessFromIndexSignature": false');
  });

  test("keeps strict mode enabled", async () => {
    const config = await rootTypeScriptConfigSource();

    expect(config).toContain('"strict": true');
  });
});

function rootTypeScriptConfigSource(): Promise<string> {
  return readFile(join(repoRoot, "tsconfig.json"), "utf8");
}
