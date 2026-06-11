import { describe, expect, test } from "bun:test";
import {
  getOlosConformanceCoverage,
  isOlosConformanceAssertionId,
  OLOS_CONFORMANCE_ASSERTION_IDS,
  OLOS_CONFORMANCE_COVERAGE,
} from "./conformance";

const ASSERTION_ID_PATTERN = /^(CORE|OBJ|HLS|SEC)-[A-Z]+-\d{3}$/;

describe("conformance manifest", () => {
  test("uses stable assertion identifiers", () => {
    for (const id of OLOS_CONFORMANCE_ASSERTION_IDS) {
      expect(id).toMatch(ASSERTION_ID_PATTERN);
      expect(isOlosConformanceAssertionId(id)).toBe(true);
    }

    expect(isOlosConformanceAssertionId("CORE-NOT-A-REAL-ID")).toBe(false);
  });

  test("does not duplicate assertion identifiers", () => {
    expect(new Set(OLOS_CONFORMANCE_ASSERTION_IDS).size).toBe(
      OLOS_CONFORMANCE_ASSERTION_IDS.length
    );
  });

  test("maps covered assertions to known assertion identifiers", () => {
    const assertionIds = new Set(OLOS_CONFORMANCE_ASSERTION_IDS);

    for (const entry of OLOS_CONFORMANCE_COVERAGE) {
      expect(assertionIds.has(entry.id)).toBe(true);
      expect(isCoveredTestFile(entry.testFile)).toBe(true);
    }
  });

  test("does not duplicate coverage entries", () => {
    expect(
      new Set(OLOS_CONFORMANCE_COVERAGE.map((entry) => entry.id)).size
    ).toBe(OLOS_CONFORMANCE_COVERAGE.length);
  });

  test("finds coverage by assertion identifier", () => {
    expect(getOlosConformanceCoverage("OBJ-GRANT-001")).toEqual({
      id: "OBJ-GRANT-001",
      level: "object",
      status: "covered",
      testFile: "src/s3/upload-grant.test.ts",
    });
  });
});

function isCoveredTestFile(value: string): boolean {
  return value.startsWith("src/") || value.startsWith("e2e/");
}
