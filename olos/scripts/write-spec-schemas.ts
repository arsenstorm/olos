import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OLOS_JSON_SCHEMAS } from "../src/schema";
import { isCliEntry } from "./script-entry";
import { repoRoot } from "./script-paths";

export const specSchemasAppendixPath = join(
  repoRoot,
  "spec",
  "appendix-a-schemas.md"
);

const JSON_INDENT = 2;

if (isCliEntry(import.meta.url)) {
  const appendix = buildSpecSchemasAppendix();

  if (process.argv.includes("--check")) {
    const committed = await readCommittedAppendix();

    if (committed !== appendix) {
      console.error(
        "spec/appendix-a-schemas.md is out of date with OLOS_JSON_SCHEMAS; " +
          "regenerate it with `bun run spec:generate` (in olos/)."
      );
      process.exit(1);
    }

    console.log("spec/appendix-a-schemas.md is up to date");
  } else {
    await writeFile(specSchemasAppendixPath, appendix);
    console.log(`wrote ${specSchemasAppendixPath}`);
  }
}

export function buildSpecSchemasAppendix(): string {
  const lines = [
    "# Appendix A: JSON Schemas",
    "",
    "<!-- GENERATED FILE - DO NOT EDIT. Regenerate with `bun run spec:generate` (in olos/), source: olos/scripts/write-spec-schemas.ts -->",
    "",
    "This appendix is generated from the `OLOS_JSON_SCHEMAS` export of",
    "`olos/src/schema.ts` (published as `@arsenstorm/olos/schema`). Each",
    "section reproduces one wire-format JSON Schema verbatim, keyed by its",
    "document name.",
    ...Object.entries(OLOS_JSON_SCHEMAS).flatMap(([name, schema]) =>
      schemaSection(name, schema)
    ),
  ];

  return `${lines.join("\n")}\n`;
}

function schemaSection(name: string, schema: unknown): string[] {
  return [
    "",
    `## \`${name}\``,
    "",
    "```json",
    JSON.stringify(schema, null, JSON_INDENT),
    "```",
  ];
}

async function readCommittedAppendix(): Promise<string> {
  try {
    return await readFile(specSchemasAppendixPath, "utf8");
  } catch {
    return "";
  }
}
