import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OLOS_CONFORMANCE_ASSERTION_IDS,
  OLOS_CONFORMANCE_COVERAGE,
  type OlosConformanceAssertionId,
  type OlosConformanceLevel,
} from "../src/conformance";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(packageRoot);
const reportRoot = join(repoRoot, "out", "conformance");
const reportPath = join(reportRoot, "conformance.md");

const levels = ["core", "object", "hls", "security"] as const;
const report = buildReport();

await mkdir(reportRoot, { recursive: true });
await writeFile(reportPath, report);

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n${report}`);
}

console.log(report);

function buildReport(): string {
  const rows = levels.map((level) => countLevel(level));
  const total = rows.reduce(
    (sum, row) => ({
      covered: sum.covered + row.covered,
      known: sum.known + row.known,
      mapped: sum.mapped + row.mapped,
      partial: sum.partial + row.partial,
      unmapped: sum.unmapped + row.unmapped,
    }),
    { covered: 0, known: 0, mapped: 0, partial: 0, unmapped: 0 }
  );
  const unmappedIds = OLOS_CONFORMANCE_ASSERTION_IDS.filter(
    (id) => !OLOS_CONFORMANCE_COVERAGE.some((entry) => entry.id === id)
  );
  const lines = [
    "# OLOS Conformance",
    "",
    "| Level | Known | Mapped | Covered | Partial | Unmapped |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${labelLevel(row.level)} | ${row.known} | ${row.mapped} | ${row.covered} | ${row.partial} | ${row.unmapped} |`
    ),
    `| Total | ${total.known} | ${total.mapped} | ${total.covered} | ${total.partial} | ${total.unmapped} |`,
    "",
    "Generated from `olos/src/conformance.ts`.",
  ];

  if (unmappedIds.length > 0) {
    lines.push("", "## Unmapped Assertions", "");
    for (const id of unmappedIds) {
      lines.push(`- \`${id}\``);
    }
  }

  lines.push("", "## Mapped Assertions");

  for (const level of levels) {
    const entries = OLOS_CONFORMANCE_COVERAGE.filter(
      (entry) => entry.level === level
    );

    lines.push(
      "",
      `### ${labelLevel(level)}`,
      "",
      "| ID | Status | Test file |",
      "| --- | --- | --- |",
      ...entries.map(
        (entry) =>
          `| \`${entry.id}\` | ${entry.status} | \`${entry.testFile}\` |`
      )
    );
  }

  return `${lines.join("\n")}\n`;
}

function countLevel(level: OlosConformanceLevel) {
  const known = OLOS_CONFORMANCE_ASSERTION_IDS.filter(
    (id) => levelFromAssertionId(id) === level
  ).length;
  const coverage = OLOS_CONFORMANCE_COVERAGE.filter(
    (entry) => entry.level === level
  );

  return {
    covered: coverage.filter((entry) => entry.status === "covered").length,
    known,
    level,
    mapped: coverage.length,
    partial: coverage.filter((entry) => entry.status === "partial").length,
    unmapped: known - coverage.length,
  };
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
