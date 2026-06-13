import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  assertCoordinatorPipelineStoreConformance,
  getOlosConformanceCoverage,
  isOlosConformanceAssertionId,
  OLOS_CONFORMANCE_ASSERTION_IDS,
  OLOS_CONFORMANCE_COVERAGE,
} from "./conformance";
import { createMemoryCoordinatorStore } from "./protocol";

const ASSERTION_ID_PATTERN = /^(CORE|OBJ|HLS|SEC)-[A-Z]+-\d{3}$/;
const DOCUMENTED_ASSERTION_ID_PATTERN = /`([A-Z]+(?:-[A-Z]+)*-\d{3})`/g;

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

  test("maps covered assertions to existing test files", () => {
    for (const entry of OLOS_CONFORMANCE_COVERAGE) {
      expect(coverageTestFileExists(entry.testFile)).toBe(true);
    }
  });

  test("documents every executable assertion in the conformance spec", () => {
    const documented = documentedAssertionIds();

    expect(
      OLOS_CONFORMANCE_ASSERTION_IDS.filter((id) => !documented.has(id))
    ).toEqual([]);
  });

  test("does not duplicate coverage entries", () => {
    expect(
      new Set(OLOS_CONFORMANCE_COVERAGE.map((entry) => entry.id)).size
    ).toBe(OLOS_CONFORMANCE_COVERAGE.length);
  });

  test("matches the documented coverage snapshot", () => {
    expect(countCoverageByLevel()).toEqual({
      core: 62,
      hls: 14,
      object: 40,
      security: 7,
      total: 123,
    });
  });

  test("finds coverage by assertion identifier", () => {
    expect(getOlosConformanceCoverage("OBJ-GRANT-001")).toEqual({
      id: "OBJ-GRANT-001",
      level: "object",
      status: "covered",
      testFile: "src/s3/upload-grant.test.ts",
    });
  });

  test("maps schema conformance to the schema export tests", () => {
    expect(getOlosConformanceCoverage("CORE-SCHEMA-001")).toEqual({
      id: "CORE-SCHEMA-001",
      level: "core",
      status: "covered",
      testFile: "src/schema.test.ts",
    });
  });

  test("maps revoked-slot conformance to coordinator tests", () => {
    expect(getOlosConformanceCoverage("CORE-SLOT-006")).toEqual({
      id: "CORE-SLOT-006",
      level: "core",
      status: "covered",
      testFile: "src/protocol/coordinator.test.ts",
    });
    expect(getOlosConformanceCoverage("CORE-SLOT-007")).toEqual({
      id: "CORE-SLOT-007",
      level: "core",
      status: "covered",
      testFile: "src/protocol/coordinator.test.ts",
    });
  });

  test("maps verified-object conformance to state tests", () => {
    expect(getOlosConformanceCoverage("CORE-COMMIT-006")).toEqual({
      id: "CORE-COMMIT-006",
      level: "core",
      status: "covered",
      testFile: "src/state/commit.test.ts",
    });
    expect(getOlosConformanceCoverage("CORE-EVENT-002")).toEqual({
      id: "CORE-EVENT-002",
      level: "core",
      status: "covered",
      testFile: "src/state/observed-upload.test.ts",
    });
  });

  test("asserts coordinator store conformance", async () => {
    await expect(
      assertCoordinatorPipelineStoreConformance({
        createStore: createMemoryCoordinatorStore,
      })
    ).resolves.toBeUndefined();
  });
});

function isCoveredTestFile(value: string): boolean {
  return value.startsWith("src/") || value.startsWith("e2e/");
}

function coverageTestFileExists(value: string): boolean {
  return existsSync(new URL(`../${value}`, import.meta.url));
}

function documentedAssertionIds(): Set<string> {
  const spec = readFileSync(
    new URL("../../specs/08-conformance.md", import.meta.url),
    "utf8"
  );

  return new Set(
    [...spec.matchAll(DOCUMENTED_ASSERTION_ID_PATTERN)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]]
    )
  );
}

function countCoverageByLevel() {
  return {
    core: countCoverage("core"),
    hls: countCoverage("hls"),
    object: countCoverage("object"),
    security: countCoverage("security"),
    total: OLOS_CONFORMANCE_COVERAGE.length,
  };
}

function countCoverage(level: string): number {
  return OLOS_CONFORMANCE_COVERAGE.filter((entry) => entry.level === level)
    .length;
}
