import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("release documentation", () => {
  test("keeps v0.1 package readiness separate from deployment readiness", () => {
    const releases = readFileSync(
      new URL("../../contributing/repository/releases.md", import.meta.url),
      "utf8"
    );

    expect(releases).toContain("## v0.1 Readiness");
    expect(releases).toContain("Treat `v0.1` as package-ready");
    expect(releases).toContain("`publish:check` passes from a clean checkout");
    expect(releases).toContain(
      "The conformance report has no unmapped assertions"
    );
    expect(releases).toContain("The production wiring E2E passes");
    expect(releases).toContain(
      "Treat a deployment as production-ready only after the application also proves"
    );
    expect(releases).toContain("publisher and viewer authentication");
    expect(releases).toContain(
      "a transactional or conditional-write coordinator store"
    );
    expect(releases).toContain(
      "real S3-compatible provider behavior with `test:live-s3` or equivalent"
    );
    expect(releases).toContain(
      "health polling, stale lease alerts, recovery scheduling, and retention retry"
    );
  });
});
