import type { Dirent } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { isCliEntry } from "./script-entry";
import { packageRoot } from "./script-paths";

const distRoot = join(packageRoot, "dist");
// Covers static `from "..."`, side-effect `import "..."`, and dynamic
// `import("...")` specifiers — Node's ESM resolver rejects every
// extensionless relative form, not just the `from` clause.
const relativeImportPattern =
  /((?:from\s+|import\s+|import\(\s*)["'])(\.[^"']+)(["'])/g;

if (isCliEntry(import.meta.url)) {
  await fixDeclarationImports();
}

export async function fixDeclarationImports(
  directory = distRoot
): Promise<void> {
  for (const entry of await declarationDirectoryEntries(directory)) {
    await fixDeclarationEntry(directory, entry);
  }
}

function declarationDirectoryEntries(directory: string): Promise<Dirent[]> {
  return readdir(directory, { withFileTypes: true });
}

async function fixDeclarationEntry(
  directory: string,
  entry: Dirent
): Promise<void> {
  const path = join(directory, entry.name);

  if (entry.isDirectory()) {
    await fixDeclarationImports(path);
    return;
  }

  if (isEmittedModuleFile(entry)) {
    await fixDeclaration(path);
  }
}

// Runtime .js output needs the same treatment as declarations: tsc emits
// relative specifiers verbatim, and Node's ESM resolver rejects
// extensionless paths that Bun tolerates.
function isEmittedModuleFile(entry: Dirent): boolean {
  return (
    entry.isFile() &&
    (entry.name.endsWith(".d.ts") || entry.name.endsWith(".js"))
  );
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
