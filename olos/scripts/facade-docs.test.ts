import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Facade documentation gate: every symbol re-exported by a public facade
 * must have a `/** ... *\/` JSDoc block immediately preceding its
 * definition. Re-export chains are followed to the true definition site;
 * symbols defined directly in a facade (index.ts, conformance.ts,
 * schema.ts) are checked in place.
 */

const SRC_DIR = resolve(import.meta.dir, "..", "src");

const FACADES = [
  "config.ts",
  "conformance.ts",
  "hls.ts",
  "index.ts",
  "protocol.ts",
  "runtime.ts",
  "s3.ts",
  "schema.ts",
  "state.ts",
  "types.ts",
  "validation.ts",
] as const;

/**
 * Facade exports the checker cannot resolve or intentionally does not
 * check. Add entries as `"<facade>:<exported name>"` with a comment
 * explaining why.
 */
const SKIP_LIST = new Set<string>([]);

const MAX_REEXPORT_DEPTH = 5;

interface ReExportEntry {
  exportedName: string;
  sourceName: string;
}

interface ReExportClause {
  entries: ReExportEntry[];
  specifier: string;
}

const RE_EXPORT_CLAUSE_PATTERN =
  /export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;

const RE_EXPORT_TYPE_PREFIX_PATTERN = /^type\s+/;

const RE_EXPORT_ALIAS_PATTERN = /^(\S+)\s+as\s+(\S+)$/;

const fileCache = new Map<string, string>();

function readSource(path: string): string {
  let content = fileCache.get(path);

  if (content === undefined) {
    content = readFileSync(path, "utf8");
    fileCache.set(path, content);
  }

  return content;
}

function parseReExportClauses(content: string): ReExportClause[] {
  const clauses: ReExportClause[] = [];

  for (const match of content.matchAll(RE_EXPORT_CLAUSE_PATTERN)) {
    clauses.push({
      entries: parseReExportEntries(match[1] ?? ""),
      specifier: match[2] ?? "",
    });
  }

  return clauses;
}

function parseReExportEntries(body: string): ReExportEntry[] {
  return body
    .split(",")
    .map((entry) => entry.trim().replace(RE_EXPORT_TYPE_PREFIX_PATTERN, ""))
    .filter((entry) => entry.length > 0)
    .map(parseReExportEntry);
}

function parseReExportEntry(entry: string): ReExportEntry {
  const aliased = entry.match(RE_EXPORT_ALIAS_PATTERN);

  if (aliased?.[1] !== undefined && aliased[2] !== undefined) {
    return { exportedName: aliased[2], sourceName: aliased[1] };
  }

  return { exportedName: entry, sourceName: entry };
}

function resolveModulePath(fromFile: string, specifier: string): string {
  return join(dirname(fromFile), `${specifier}.ts`);
}

function definitionPattern(name: string): RegExp {
  return new RegExp(
    "^export (?:abstract )?(?:async )?" +
      "(?:function\\*? |const |let |var |class |interface |type |enum )" +
      `${name}\\b`,
    "m"
  );
}

function hasDocumentedDefinition(
  content: string,
  name: string
): boolean | undefined {
  const match = definitionPattern(name).exec(content);

  if (match === null) {
    return;
  }

  return content.slice(0, match.index).trimEnd().endsWith("*/");
}

/**
 * Follow `name` from `file` through re-export chains until a definition is
 * found. Returns a failure message, or undefined when the definition
 * exists and carries a JSDoc block.
 */
function checkSymbol(
  file: string,
  name: string,
  depth: number
): string | undefined {
  const content = readSource(file);
  const documented = hasDocumentedDefinition(content, name);

  if (documented === true) {
    return;
  }

  if (documented === false) {
    return `${file}: '${name}' is missing a JSDoc block at its definition`;
  }

  if (depth >= MAX_REEXPORT_DEPTH) {
    return `${file}: '${name}' re-export chain exceeds depth ${MAX_REEXPORT_DEPTH}`;
  }

  for (const clause of parseReExportClauses(content)) {
    const entry = clause.entries.find((item) => item.exportedName === name);

    if (entry !== undefined) {
      return checkSymbol(
        resolveModulePath(file, clause.specifier),
        entry.sourceName,
        depth + 1
      );
    }
  }

  return `${file}: could not locate a definition or re-export of '${name}'`;
}

function directFacadeDefinitions(content: string): string[] {
  const names: string[] = [];
  const pattern =
    /^export (?:abstract )?(?:async )?(?:function\*? |const |let |var |class |interface |type |enum )([A-Za-z0-9_$]+)/gm;

  for (const match of content.matchAll(pattern)) {
    if (match[1] !== undefined) {
      names.push(match[1]);
    }
  }

  return names;
}

function collectFacadeFailures(facade: string): string[] {
  const facadePath = join(SRC_DIR, facade);
  const content = readSource(facadePath);
  const failures: string[] = [];

  const check = (name: string, file: string, depth: number): void => {
    if (SKIP_LIST.has(`${facade}:${name}`)) {
      return;
    }

    const failure = checkSymbol(file, name, depth);

    if (failure !== undefined) {
      failures.push(`[${facade}] ${failure}`);
    }
  };

  for (const clause of parseReExportClauses(content)) {
    const modulePath = resolveModulePath(facadePath, clause.specifier);

    for (const entry of clause.entries) {
      check(entry.sourceName, modulePath, 1);
    }
  }

  for (const name of directFacadeDefinitions(content)) {
    check(name, facadePath, 0);
  }

  return failures;
}

test("every facade-exported symbol is documented at its definition", () => {
  const failures = FACADES.flatMap((facade) => collectFacadeFailures(facade));

  expect(failures).toEqual([]);
});

test("facades re-export a meaningful number of symbols", () => {
  // Guards the parser itself: if the re-export regex silently stops
  // matching, the documentation test above would pass vacuously.
  const totalExports = FACADES.reduce((total, facade) => {
    const content = readSource(join(SRC_DIR, facade));
    const reExported = parseReExportClauses(content).reduce(
      (count, clause) => count + clause.entries.length,
      0
    );

    return total + reExported + directFacadeDefinitions(content).length;
  }, 0);

  expect(totalExports).toBeGreaterThan(300);
});
