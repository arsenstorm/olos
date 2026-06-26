import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  OLOS_CONFORMANCE_ASSERTION_IDS,
  OLOS_CONFORMANCE_COVERAGE,
  type OlosConformanceAssertionId,
  type OlosConformanceLevel,
} from "../src/conformance";
import { isCliEntry } from "./script-entry";
import { repoRoot } from "./script-paths";

const reportRoot = join(repoRoot, "out", "conformance");
const reportPath = join(reportRoot, "conformance.md");

const levels = ["core", "object", "hls", "security"] as const;
const coveredAssertionIds = new Set(
  OLOS_CONFORMANCE_COVERAGE.map((entry) => entry.id)
);

type ConformanceCoverageEntry = (typeof OLOS_CONFORMANCE_COVERAGE)[number];

if (isCliEntry(import.meta.url)) {
  const report = buildConformanceReport();

  await mkdir(reportRoot, { recursive: true });
  await writeFile(reportPath, report);

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
    "| ID | Status | Test file |",
    "| --- | --- | --- |",
    ...entries.map(formatMappedAssertionRow),
  ];
}

function formatMappedAssertionRow(entry: ConformanceCoverageEntry): string {
  return `| \`${entry.id}\` | ${entry.status} | \`${entry.testFile}\` |`;
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
  return level === "hls" ? "HLS" : `${level[0].toUpperCase()}${level.slice(1)}`;
}

function levelFromAssertionId(
  id: OlosConformanceAssertionId
): OlosConformanceLevel {
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
