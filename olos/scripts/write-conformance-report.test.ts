import { describe, expect, test } from "bun:test";
import { buildConformanceReport } from "./write-conformance-report";

describe("conformance report writer", () => {
  test("includes summary counts and mapped assertion rows", () => {
    const report = buildConformanceReport();

    expect(report).toContain("| Total | 110 | 110 | 110 | 0 | 0 |");
    expect(report).toContain("## Mapped Assertions");
    expect(report).toContain("### Object");
    expect(report).toContain(
      "| `OBJ-RUNTIME-008` | covered | `e2e/s3-http-pipeline.test.ts` |"
    );
  });
});
