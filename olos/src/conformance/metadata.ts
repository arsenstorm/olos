import {
  OLOS_CONFORMANCE_ASSERTION_IDS,
  OLOS_CONFORMANCE_COVERAGE_ROWS,
  type OlosConformanceAssertionId,
} from "./coverage-rows";
import type {
  OlosConformanceCoverageStatus,
  OlosConformanceLevel,
} from "./coverage-types";

export type {
  OlosConformanceCoverageStatus,
  OlosConformanceLevel,
} from "./coverage-types";

/** One row of the conformance coverage table. */
export interface OlosConformanceCoverage {
  id: OlosConformanceAssertionId;
  level: OlosConformanceLevel;
  status: OlosConformanceCoverageStatus;
  testFile: string;
}

const OLOS_CONFORMANCE_ASSERTION_ID_SET = new Set<string>(
  OLOS_CONFORMANCE_ASSERTION_IDS
);

type CoverageRow = readonly [
  id: OlosConformanceAssertionId,
  level: OlosConformanceLevel,
  testFile: string,
  section: string | null,
  status?: OlosConformanceCoverageStatus,
];

function coverage([
  id,
  level,
  testFile,
  ,
  status = "covered",
]: CoverageRow): OlosConformanceCoverage {
  return { id, level, status, testFile };
}

/**
 * The full conformance coverage table: one entry per assertion id, naming
 * the test file that covers it and whether coverage is complete or
 * partial.
 */
export const OLOS_CONFORMANCE_COVERAGE =
  OLOS_CONFORMANCE_COVERAGE_ROWS.map(coverage);

const OLOS_CONFORMANCE_COVERAGE_BY_ID = new Map<
  OlosConformanceAssertionId,
  OlosConformanceCoverage
>(OLOS_CONFORMANCE_COVERAGE.map((entry) => [entry.id, entry]));

/**
 * Looks up the coverage entry for a conformance assertion id, or
 * `undefined` for an unknown id.
 */
export function getOlosConformanceCoverage(
  id: OlosConformanceAssertionId
): OlosConformanceCoverage | undefined {
  return OLOS_CONFORMANCE_COVERAGE_BY_ID.get(id);
}

/** Returns whether `value` is a known OLOS conformance assertion id. */
export function isOlosConformanceAssertionId(
  value: string
): value is OlosConformanceAssertionId {
  return OLOS_CONFORMANCE_ASSERTION_ID_SET.has(value);
}
