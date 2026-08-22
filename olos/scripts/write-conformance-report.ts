import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  OLOS_CONFORMANCE_ASSERTION_IDS,
  OLOS_CONFORMANCE_COVERAGE,
  OLOS_CONFORMANCE_SPEC_REFS,
  type OlosConformanceAssertionId,
  type OlosConformanceLevel,
} from "../src/conformance";
import { isCliEntry } from "./script-entry";
import { repoRoot } from "./script-paths";

const reportRoot = join(repoRoot, "out", "conformance");
const reportPath = join(reportRoot, "conformance.md");

export const specConformanceAppendixPath = join(
  repoRoot,
  "spec",
  "appendix-b-conformance.md"
);

const SPEC_REF_PLACEHOLDER = "—";

const levels = ["core", "runtime", "object", "hls", "security"] as const;
const coveredAssertionIds = new Set(
  OLOS_CONFORMANCE_COVERAGE.map((entry) => entry.id)
);

type ConformanceCoverageEntry = (typeof OLOS_CONFORMANCE_COVERAGE)[number];

if (isCliEntry(import.meta.url)) {
  const report = buildConformanceReport();

  await mkdir(reportRoot, { recursive: true });
  await writeFile(reportPath, report);
  await writeFile(specConformanceAppendixPath, buildConformanceSpecAppendix());

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n${report}`);
  }

  console.log(report);
}

export interface ConformanceReportSummary {
  covered: number;
  known: number;
  mapped: number;
  partial: number;
  unmapped: number;
}

interface ConformanceReportLevelSummary extends ConformanceReportSummary {
  level: OlosConformanceLevel;
}

export function buildConformanceReport(): string {
  const rows = levels.map((level) => countLevel(level));
  const total = summarizeRows(rows);
  const lines = [
    "# OLOS Conformance",
    "",
    ...summaryTable(rows, total),
    "",
    "Generated from `olos/src/conformance.ts`.",
    ...unmappedAssertionsSection(unmappedAssertionIds()),
    "",
    "## Mapped Assertions",
    ...mappedAssertionsSections(),
  ];

  return `${lines.join("\n")}\n`;
}

export function buildConformanceSpecAppendix(): string {
  const lines = [
    "# Appendix B: Conformance Assertion Catalogue",
    "",
    "<!-- GENERATED FILE - DO NOT EDIT. Regenerate with `bun run spec:generate` (in olos/), source: olos/scripts/write-conformance-report.ts -->",
    "",
    "This appendix is generated from the conformance metadata in",
    "`olos/src/conformance` (published as `@arsenstorm/olos/conformance`):",
    "one table per conformance level, linking each assertion id to the spec",
    "section that claims it and the test file that covers it.",
    ...levels.flatMap((level) => appendixLevelSection(level)),
    ...unreferencedAssertionsSection(),
  ];

  return `${lines.join("\n")}\n`;
}

function appendixLevelSection(level: OlosConformanceLevel): string[] {
  return [
    "",
    `## ${labelLevel(level)}`,
    "",
    "| Assertion ID | Spec § | Test file(s) |",
    "| --- | --- | --- |",
    ...coverageForLevel(level).map(formatAppendixRow),
  ];
}

function formatAppendixRow(entry: ConformanceCoverageEntry): string {
  return `| \`${entry.id}\` | ${formatSpecRef(entry.id)} | \`${entry.testFile}\` |`;
}

function unreferencedAssertionsSection(): string[] {
  const unreferenced = OLOS_CONFORMANCE_ASSERTION_IDS.filter(
    (id) => OLOS_CONFORMANCE_SPEC_REFS[id] === null
  );

  if (unreferenced.length === 0) {
    return [];
  }

  return [
    "",
    "## Unreferenced assertions",
    "",
    "The following assertions are enforced by the reference implementation",
    "but are not yet referenced by a spec section:",
    "",
    ...unreferenced.map(formatListId),
  ];
}

function summaryTable(
  rows: readonly ConformanceReportLevelSummary[],
  total: ConformanceReportSummary
): string[] {
  return [
    "| Level | Known | Mapped | Covered | Partial | Unmapped |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(formatLevelSummaryRow),
    formatTotalSummaryRow(total),
  ];
}

function formatLevelSummaryRow(row: ConformanceReportLevelSummary): string {
  return `| ${labelLevel(row.level)} | ${row.known} | ${row.mapped} | ${row.covered} | ${row.partial} | ${row.unmapped} |`;
}

function formatTotalSummaryRow(total: ConformanceReportSummary): string {
  return `| Total | ${total.known} | ${total.mapped} | ${total.covered} | ${total.partial} | ${total.unmapped} |`;
}

function unmappedAssertionsSection(
  assertionIds: readonly OlosConformanceAssertionId[]
): string[] {
  if (assertionIds.length === 0) {
    return [];
  }

  return ["", "## Unmapped Assertions", "", ...assertionIds.map(formatListId)];
}

function mappedAssertionsSections(): string[] {
  return levels.flatMap((level) =>
    mappedAssertionsSection(level, coverageForLevel(level))
  );
}

function mappedAssertionsSection(
  level: OlosConformanceLevel,
  entries: readonly ConformanceCoverageEntry[]
): string[] {
  return [
    "",
    `### ${labelLevel(level)}`,
    "",
    "| ID | Spec § | Status | Test file |",
    "| --- | --- | --- | --- |",
    ...entries.map(formatMappedAssertionRow),
  ];
}

function formatMappedAssertionRow(entry: ConformanceCoverageEntry): string {
  return `| \`${entry.id}\` | ${formatSpecRef(entry.id)} | ${entry.status} | \`${entry.testFile}\` |`;
}

function formatSpecRef(id: OlosConformanceAssertionId): string {
  const section = OLOS_CONFORMANCE_SPEC_REFS[id];

  return section === null ? SPEC_REF_PLACEHOLDER : `§${section}`;
}

function formatListId(id: OlosConformanceAssertionId): string {
  return `- \`${id}\``;
}

function countLevel(
  level: OlosConformanceLevel
): ConformanceReportLevelSummary {
  const coverage = coverageForLevel(level);
  const known = countKnownAssertions(level);

  return {
    covered: countCoverageStatus(coverage, "covered"),
    known,
    level,
    mapped: coverage.length,
    partial: countCoverageStatus(coverage, "partial"),
    unmapped: known - coverage.length,
  };
}

export function summarizeConformance(): ConformanceReportSummary {
  return summarizeRows(levels.map((level) => countLevel(level)));
}

function summarizeRows(
  rows: readonly ConformanceReportSummary[]
): ConformanceReportSummary {
  return rows.reduce(
    (sum, row) => ({
      covered: sum.covered + row.covered,
      known: sum.known + row.known,
      mapped: sum.mapped + row.mapped,
      partial: sum.partial + row.partial,
      unmapped: sum.unmapped + row.unmapped,
    }),
    { covered: 0, known: 0, mapped: 0, partial: 0, unmapped: 0 }
  );
}

function unmappedAssertionIds(): OlosConformanceAssertionId[] {
  return OLOS_CONFORMANCE_ASSERTION_IDS.filter(
    (id) => !coveredAssertionIds.has(id)
  );
}

function coverageForLevel(
  level: OlosConformanceLevel
): ConformanceCoverageEntry[] {
  return OLOS_CONFORMANCE_COVERAGE.filter((entry) => entry.level === level);
}

function countKnownAssertions(level: OlosConformanceLevel): number {
  return OLOS_CONFORMANCE_ASSERTION_IDS.filter(
    (id) => levelFromAssertionId(id) === level
  ).length;
}

function countCoverageStatus(
  coverage: readonly ConformanceCoverageEntry[],
  status: "covered" | "partial"
): number {
  return coverage.filter((entry) => entry.status === status).length;
}

function labelLevel(level: OlosConformanceLevel): string {
  return level === "hls"
    ? "HLS"
    : `${level.charAt(0).toUpperCase()}${level.slice(1)}`;
}

function levelFromAssertionId(
  id: OlosConformanceAssertionId
): OlosConformanceLevel {
  if (id.startsWith("CORE-RUNTIME-")) {
    return "runtime";
  }

  if (id.startsWith("CORE-")) {
    return "core";
  }

  if (id.startsWith("OBJ-")) {
    return "object";
  }

  if (id.startsWith("HLS-")) {
    return "hls";
  }

  return "security";
}
