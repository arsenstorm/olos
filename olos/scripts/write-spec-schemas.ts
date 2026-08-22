import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OLOS_MEDIA_JSON_SCHEMAS } from "../src/media";
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
    "`olos/src/schema.ts` (published as `@arsenstorm/olos/schema`) and the",
    "`OLOS_MEDIA_JSON_SCHEMAS` export of `olos/src/media.ts` (published as",
    "`@arsenstorm/olos/media`). Each section reproduces one JSON Schema",
    "verbatim, keyed by its document name.",
    "",
    "## A.1 Core wire objects",
    "",
    "Profile data (`profile` fields) is an opaque JSON object in every Core",
    "schema; the profile schemas in A.2 constrain its contents.",
    ...Object.entries(OLOS_JSON_SCHEMAS).flatMap(([name, schema]) =>
      schemaSection(name, schema, "###")
    ),
    "",
    "## A.2 CMAF/LL-HLS profile (`cmaf-llhls`)",
    "",
    "Schemas for the `profile` contents of sessions, tracks, slots, commits,",
    "and committed objects under the CMAF/LL-HLS profile (Section 8).",
    ...Object.entries(OLOS_MEDIA_JSON_SCHEMAS).flatMap(([name, schema]) =>
      schemaSection(name, schema, "###")
    ),
  ];

  return `${lines.join("\n")}\n`;
}

function schemaSection(
  name: string,
  schema: unknown,
  heading: string
): string[] {
  return [
    "",
    `${heading} \`${name}\``,
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
