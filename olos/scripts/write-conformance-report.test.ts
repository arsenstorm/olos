import { describe, expect, test } from "bun:test";
import {
  buildConformanceReport,
  summarizeConformance,
} from "./write-conformance-report";

describe("conformance report writer", () => {
  test("includes summary counts and mapped assertion rows", () => {
    const report = buildConformanceReport();

    expect(report).toContain("| Total | 123 | 123 | 122 | 1 | 0 |");
    expect(report).toContain("## Mapped Assertions");
    expect(report).toContain("### Object");
    expect(report).toContain(
      "| `OBJ-RUNTIME-008` | covered | `e2e/s3-http-pipeline.test.ts` |"
    );
    expect(report).toContain(
      "| `CORE-LATE-002` | partial | `src/state/commit.test.ts` |"
    );
  });

  test("summarizes release-gated conformance coverage", () => {
    expect(summarizeConformance()).toEqual({
      covered: 122,
      known: 123,
      mapped: 123,
      partial: 1,
      unmapped: 0,
    });
  });
});
