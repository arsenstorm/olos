import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("release documentation", () => {
  test("keeps the publish workflow release-safe", () => {
    const workflow = repositoryFile(".github/workflows/publish.yml");

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain(
      "bun --filter '@arsenstorm/olos' release:verify-tag"
    );
    expect(workflow).toContain("bun run publish:check");
    expect(workflow).toContain("npm publish --provenance --access public");
    expect(workflow).toContain("working-directory: olos");
    expect(workflow).toContain(
      "bun --filter '@arsenstorm/olos' release:verify-published"
    );
  });

  test("documents the repository validation boundary", () => {
    const checks = repositoryFile("contributing/repository/checks.md");

    expect(checks).toContain("Required status check");
    expect(checks).toContain("`publish:check`");
    expect(checks).toContain("export-map dry pack");
    expect(checks).toContain(
      "The packed-package smoke test is also the public export guard"
    );
    expect(checks).toContain("keeps root `olos` limited to protocol metadata");
    expect(checks).toContain("constants, with runtime functionality exposed");
    expect(checks).toContain(
      "Provider compatibility still needs `bun run test:live-s3`"
    );
  });

  test("keeps v0.1 package readiness separate from deployment readiness", () => {
    const releases = releaseDocs();

    expect(releases).toContain("## v0.1 Readiness");
    expect(releases).toContain("Treat `v0.1` as package-ready");
    expect(releases).toContain("checks conformance coverage");
    expect(releases).toContain("export-map dry pack");
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

  test("documents published package verification with package versions", () => {
    const releases = releaseDocs();

    expect(releases).toContain(
      "bun --filter '@arsenstorm/olos' release:verify-published 0.1.0"
    );
    expect(releases).toContain(
      "Pass the npm package version, not the git tag name"
    );
  });

  test("documents compatibility intent for public-facing cleanup", () => {
    const pullRequests = repositoryFile(
      "contributing/repository/pull-request-descriptions.md"
    );
    const releases = releaseDocs();

    expect(pullRequests).toContain("state the compatibility intent explicitly");
    expect(pullRequests).toContain("Public behavior unchanged");
    expect(releases).toContain(
      "Behavior-preserving public-facing cleanups can stay out of the changelog"
    );
    expect(releases).toContain("Any cleanup that changes public behavior");
  });
});

function releaseDocs(): string {
  return repositoryFile("contributing/repository/releases.md");
}

function repositoryFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}
