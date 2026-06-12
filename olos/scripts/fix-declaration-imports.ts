import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = join(packageRoot, "dist");
const relativeImportPattern = /(from\s+["'])(\.[^"']+)(["'])/g;

await fixDeclarations(distRoot);

async function fixDeclarations(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      await fixDeclarations(path);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".d.ts")) {
      await fixDeclaration(path);
    }
  }
}

async function fixDeclaration(path: string): Promise<void> {
  const source = await readFile(path, "utf8");
  const fixed = source.replace(
    relativeImportPattern,
    (_match, prefix: string, specifier: string, suffix: string) =>
      `${prefix}${withJsExtension(specifier)}${suffix}`
  );

  if (fixed !== source) {
    await writeFile(path, fixed);
  }
}

function withJsExtension(specifier: string): string {
  const lastSegment = specifier.split("/").at(-1) ?? specifier;

  if (extname(lastSegment) !== "") {
    return specifier;
  }

  return `${specifier}.js`;
}
