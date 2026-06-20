import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixDeclarationImports } from "./fix-declaration-imports";
import { withTemporaryDirectory } from "./test-temp-dir";

describe("declaration import fixer", () => {
  test("adds js extensions to relative declaration imports", async () => {
    await withTemporaryDirectory("olos-dts-", async (directory) => {
      const declaration = join(directory, "index.d.ts");

      await writeFile(
        declaration,
        [
          'export { createThing } from "./thing";',
          'export type { Thing } from "./types/thing";',
          'export { ready } from "./ready.js";',
          'export { value } from "external";',
        ].join("\n")
      );

      await fixDeclarationImports(directory);

      await expect(readFile(declaration, "utf8")).resolves.toBe(
        [
          'export { createThing } from "./thing.js";',
          'export type { Thing } from "./types/thing.js";',
          'export { ready } from "./ready.js";',
          'export { value } from "external";',
        ].join("\n")
      );
    });
  });
});
