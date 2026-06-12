import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixDeclarationImports } from "./fix-declaration-imports";

describe("declaration import fixer", () => {
  test("adds js extensions to relative declaration imports", async () => {
    const directory = await mkdtemp(join(tmpdir(), "olos-dts-"));
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
