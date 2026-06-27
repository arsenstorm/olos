import {
  OLOS_CONFORMANCE_ASSERTION_IDS as assertionIds,
  type OlosConformanceAssertionId,
} from "./assertion-ids";
import {
  OLOS_CONFORMANCE_COVERAGE_ROWS,
  type OlosConformanceCoverageRow,
} from "./coverage-rows";

export type { OlosConformanceAssertionId } from "./assertion-ids";
export const OLOS_CONFORMANCE_ASSERTION_IDS = assertionIds;

export type OlosConformanceLevel =
  | "core"
  | "hls"
  | "object"
  | "runtime"
  | "security";
export type OlosConformanceCoverageStatus = "covered" | "partial";

export interface OlosConformanceCoverage {
  id: OlosConformanceAssertionId;
  level: OlosConformanceLevel;
  status: OlosConformanceCoverageStatus;
  testFile: string;
}

const OLOS_CONFORMANCE_ASSERTION_ID_SET = new Set<string>(
  OLOS_CONFORMANCE_ASSERTION_IDS
);

function coverage([
  id,
  level,
  testFile,
  status = "covered",
]: OlosConformanceCoverageRow): OlosConformanceCoverage {
  return { id, level, status, testFile };
}

function defineConformanceCoverage<
  const T extends readonly OlosConformanceCoverage[],
>(items: T): T {
  const mapped = new Set<string>();

  for (const entry of items) {
    if (!OLOS_CONFORMANCE_ASSERTION_ID_SET.has(entry.id)) {
      throw new Error(`unknown conformance assertion coverage id: ${entry.id}`);
    }

    if (mapped.has(entry.id)) {
      throw new Error(
        `duplicate conformance assertion coverage id: ${entry.id}`
      );
    }

    mapped.add(entry.id);
  }

  const missing = OLOS_CONFORMANCE_ASSERTION_IDS.filter(
    (id) => !mapped.has(id)
  );

  if (missing.length > 0) {
    throw new Error(
      `missing conformance assertion coverage ids: ${missing.join(", ")}`
    );
  }

  return items;
}

export const OLOS_CONFORMANCE_COVERAGE = defineConformanceCoverage(
  OLOS_CONFORMANCE_COVERAGE_ROWS.map(coverage)
);

const OLOS_CONFORMANCE_COVERAGE_BY_ID = new Map<
  OlosConformanceAssertionId,
  OlosConformanceCoverage
>(OLOS_CONFORMANCE_COVERAGE.map((entry) => [entry.id, entry]));

export function getOlosConformanceCoverage(
  id: OlosConformanceAssertionId
): OlosConformanceCoverage | undefined {
  return OLOS_CONFORMANCE_COVERAGE_BY_ID.get(id);
}

export function isOlosConformanceAssertionId(
  value: string
): value is OlosConformanceAssertionId {
  return OLOS_CONFORMANCE_ASSERTION_ID_SET.has(value);
}
