import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./script-paths";

const forbiddenRootCompilerOptions = ["allowJs", "jsx"] as const;

const requiredRootCompilerOptions = [
  {
    name: "strict",
    value: true,
  },
  {
    name: "noUnusedLocals",
    value: true,
  },
  {
    name: "noUnusedParameters",
    value: true,
  },
  {
    name: "noPropertyAccessFromIndexSignature",
    value: false,
  },
] as const;

describe("TypeScript config", () => {
  test("keeps the root compiler config TypeScript-only and JSX-free", async () => {
    const config = await rootTypeScriptConfigSource();

    for (const option of forbiddenRootCompilerOptions) {
      expect(config).not.toContain(compilerOptionName(option));
    }
  });

  test("keeps root compiler option expectations explicit", async () => {
    const config = await rootTypeScriptConfigSource();

    for (const option of requiredRootCompilerOptions) {
      expect(config).toContain(compilerOptionValue(option.name, option.value));
    }
  });
});

function rootTypeScriptConfigSource(): Promise<string> {
  return readFile(join(repoRoot, "tsconfig.json"), "utf8");
}

function compilerOptionName(name: string): string {
  return `"${name}"`;
}

function compilerOptionValue(name: string, value: boolean): string {
  return `${compilerOptionName(name)}: ${value}`;
}
