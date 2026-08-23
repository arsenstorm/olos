import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  isOlosConformanceAssertionId,
  OLOS_CONFORMANCE_SPEC_REFS,
} from "../src/conformance";
import { repoRoot } from "./script-paths";
import {
  buildConformanceSpecAppendix,
  specConformanceAppendixPath,
} from "./write-conformance-report";
import {
  buildSpecSchemasAppendix,
  specSchemasAppendixPath,
} from "./write-spec-schemas";

const specDir = join(repoRoot, "spec");

const ANCHOR_PATTERN =
  /^<!--\s*olos-conformance:\s+(\d{1,2}(?:\.\d+)*)((?:\s+[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)+)\s*-->$/;
const NUMBERED_SPEC_FILE_PATTERN = /^(\d{2})-.+\.md$/;
const ANCHOR_ID_SEPARATOR_PATTERN = /\s+/;
const SECTION_HEADING_PATTERN = /^#{1,6}\s+(\d{1,2}(?:\.\d+)*)\b/;

interface SpecAnchorClaim {
  file: string;
  section: string;
}

const failures: string[] = [];
const claims = new Map<string, SpecAnchorClaim>();

for (const file of await listSpecFiles()) {
  // biome-ignore lint/performance/noAwaitInLoops: anchors are registered against the claims map the previous file filled, so duplicate reports name the first claimant.
  await collectFileAnchors(file);
}

checkSpecRefsTable();
await checkGeneratedAppendix(
  "spec/appendix-a-schemas.md",
  specSchemasAppendixPath,
  buildSpecSchemasAppendix()
);
await checkGeneratedAppendix(
  "spec/appendix-b-conformance.md",
  specConformanceAppendixPath,
  buildConformanceSpecAppendix()
);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`spec-refs: ${failure}`);
  }

  process.exit(1);
}

console.log(
  `Spec refs: ${claims.size} assertion(s) anchored across spec sections, table and appendices in sync`
);

async function listSpecFiles(): Promise<string[]> {
  const entries = await readdir(specDir);

  return entries.filter((entry) => entry.endsWith(".md")).sort();
}

async function collectFileAnchors(file: string): Promise<void> {
  const text = await readFile(join(specDir, file), "utf8");
  const headings = collectSectionHeadings(text);

  for (const line of text.split("\n")) {
    if (!line.includes("olos-conformance")) {
      continue;
    }

    const match = line.trim().match(ANCHOR_PATTERN);

    if (match?.[1] === undefined || match[2] === undefined) {
      failures.push(
        `${file}: malformed olos-conformance anchor: ${line.trim()}`
      );
      continue;
    }

    recordAnchor(
      file,
      match[1],
      match[2].trim().split(ANCHOR_ID_SEPARATOR_PATTERN),
      headings
    );
  }
}

function collectSectionHeadings(text: string): ReadonlySet<string> {
  const headings = new Set<string>();

  for (const line of text.split("\n")) {
    const match = line.match(SECTION_HEADING_PATTERN);

    if (match?.[1] !== undefined) {
      headings.add(match[1]);
    }
  }

  return headings;
}

function recordAnchor(
  file: string,
  section: string,
  ids: string[],
  headings: ReadonlySet<string>
): void {
  checkSectionPrefix(file, section, headings);

  for (const id of ids) {
    if (!isOlosConformanceAssertionId(id)) {
      failures.push(`${file}: §${section} claims unknown assertion id ${id}`);
      continue;
    }

    const existing = claims.get(id);

    if (existing !== undefined) {
      failures.push(
        `${id} is claimed by two sections: §${existing.section} (${existing.file}) and §${section} (${file})`
      );
      continue;
    }

    claims.set(id, { file, section });
  }
}

function checkSectionPrefix(
  file: string,
  section: string,
  headings: ReadonlySet<string>
): void {
  const match = file.match(NUMBERED_SPEC_FILE_PATTERN);

  if (match?.[1] === undefined) {
    failures.push(
      `${file}: olos-conformance anchors are only allowed in numbered spec sections (NN-*.md)`
    );
    return;
  }

  const filePrefix = String(Number.parseInt(match[1], 10));

  if (section !== filePrefix && !section.startsWith(`${filePrefix}.`)) {
    failures.push(
      `${file}: anchor section §${section} does not belong to section ${filePrefix}`
    );
    return;
  }

  // The numeric prefix alone cannot catch an anchor pointing at a
  // sub-section that does not exist; require a matching heading.
  if (section !== filePrefix && !headings.has(section)) {
    failures.push(
      `${file}: anchor section §${section} has no matching heading in the file`
    );
  }
}

function checkSpecRefsTable(): void {
  for (const [id, section] of Object.entries(OLOS_CONFORMANCE_SPEC_REFS)) {
    const claim = claims.get(id);

    if (claim === undefined && section !== null) {
      failures.push(
        `OLOS_CONFORMANCE_SPEC_REFS maps ${id} to §${section}, but no spec anchor claims it (expected null)`
      );
      continue;
    }

    if (claim !== undefined && claim.section !== section) {
      failures.push(
        `OLOS_CONFORMANCE_SPEC_REFS maps ${id} to ${formatSection(section)}, but ${claim.file} anchors it under §${claim.section}`
      );
    }
  }
}

function formatSection(section: string | null): string {
  return section === null ? "null" : `§${section}`;
}

async function checkGeneratedAppendix(
  label: string,
  path: string,
  expected: string
): Promise<void> {
  const committed = await readOptionalFile(path);

  if (committed === undefined) {
    failures.push(
      `${label} is missing; regenerate it with \`bun run spec:generate\` (in olos/)`
    );
    return;
  }

  if (committed !== expected) {
    failures.push(
      `${label} is out of date with its builder; regenerate it with \`bun run spec:generate\` (in olos/)`
    );
  }
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    // a generated appendix that has not been committed yet reads as absent
  }
}
