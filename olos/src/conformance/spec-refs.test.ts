import { describe, expect, test } from "bun:test";
import { OLOS_CONFORMANCE_ASSERTION_IDS } from "./coverage-rows";
import { OLOS_CONFORMANCE_SPEC_REFS } from "./spec-refs";

const SECTION_NUMBER_PATTERN = /^\d{1,2}(\.\d+)*$/;
const EXPECTED_MAPPED_COUNT = 101;

describe("conformance spec refs", () => {
  test("assertion ids are unique", () => {
    const ids = [...OLOS_CONFORMANCE_ASSERTION_IDS];

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("non-null entries look like spec section numbers", () => {
    for (const [id, section] of Object.entries(OLOS_CONFORMANCE_SPEC_REFS)) {
      if (section !== null) {
        expect(section, `spec ref for ${id}`).toMatch(SECTION_NUMBER_PATTERN);
      }
    }
  });

  test("maps the expected number of assertion ids to spec sections", () => {
    const mapped = Object.values(OLOS_CONFORMANCE_SPEC_REFS).filter(
      (section) => section !== null
    );

    expect(mapped.length).toBeGreaterThanOrEqual(EXPECTED_MAPPED_COUNT);
  });
});
