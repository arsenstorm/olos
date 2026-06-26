import { describe, expect, test } from "bun:test";
import {
  buildConformanceReport,
  summarizeConformance,
} from "./write-conformance-report";

describe("conformance report writer", () => {
  test("includes summary counts and mapped assertion rows", () => {
    const report = buildConformanceReport();

    expect(report).toContain("| Total | 127 | 127 | 127 | 0 | 0 |");
    expect(report).toContain("## Mapped Assertions");
    expect(report).toContain("### Object");
    expect(report).toContain(
      "| `OBJ-RUNTIME-008` | covered | `e2e/s3-http-pipeline.test.ts` |"
    );
    expect(report).toContain(
      "| `CORE-LATE-002` | covered | `src/state/commit.test.ts` |"
    );
    expect(report).not.toContain("## Unmapped Assertions");
  });

  test("renders mapped assertion sections for every conformance level", () => {
    const report = buildConformanceReport();

    expect(report).toContain("### Core");
    expect(report).toContain("### Object");
    expect(report).toContain("### HLS");
    expect(report).toContain("### Security");
  });

  test("summarizes release-gated conformance coverage", () => {
    expect(summarizeConformance()).toEqual({
      covered: 127,
      known: 127,
      mapped: 127,
      partial: 0,
      unmapped: 0,
    });
  });
});
