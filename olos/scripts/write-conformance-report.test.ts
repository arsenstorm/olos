import { describe, expect, test } from "bun:test";
import {
  buildConformanceReport,
  buildConformanceSpecAppendix,
  summarizeConformance,
} from "./write-conformance-report";

describe("conformance report writer", () => {
  test("includes summary counts and mapped assertion rows", () => {
    const report = buildConformanceReport();

    expect(report).toContain("| Total | 133 | 133 | 133 | 0 | 0 |");
    expect(report).toContain("## Mapped Assertions");
    expect(report).toContain("### Object");
    expect(report).toContain("| ID | Spec § | Status | Test file |");
    expect(report).toContain(
      "| `OBJ-RUNTIME-008` | — | covered | `e2e/s3-http-pipeline.test.ts` |"
    );
    expect(report).toContain(
      "| `CORE-LATE-002` | §4.5.3 | covered | `src/state/commit.test.ts` |"
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

  test("renders the spec conformance appendix", () => {
    const appendix = buildConformanceSpecAppendix();

    expect(appendix).toContain("# Appendix B: Conformance Assertion Catalogue");
    expect(appendix).toContain("<!-- GENERATED FILE - DO NOT EDIT.");
    expect(appendix).toContain("| Assertion ID | Spec § | Test file(s) |");
    expect(appendix).toContain(
      "| `CORE-WINDOW-007` | §5.2 | `src/state/committed-window.test.ts` |"
    );
    expect(appendix).toContain(
      "| `CORE-STORE-001` | — | `src/conformance.test.ts` |"
    );
    expect(appendix).toContain("## Unreferenced assertions");
    expect(appendix).toContain("- `CORE-STORE-001`");
  });

  test("summarizes release-gated conformance coverage", () => {
    expect(summarizeConformance()).toEqual({
      covered: 133,
      known: 133,
      mapped: 133,
      partial: 0,
      unmapped: 0,
    });
  });
});
