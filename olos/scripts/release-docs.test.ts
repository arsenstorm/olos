import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("release workflow", () => {
  test("keeps the publish workflow release-safe", () => {
    const workflow = repositoryFile(".github/workflows/publish.yml");

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("environment: npm");
    expect(workflow).toContain(
      'git merge-base --is-ancestor "$GITHUB_SHA" origin/main'
    );
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserts literal shell text
    expect(workflow).toContain('test "$GITHUB_REF_NAME" = "olos-v${version}"');
    expect(workflow).toContain("bun run publish:check");
    expect(workflow).toContain("npm publish --provenance --access public");
    expect(workflow).toContain("working-directory: olos");
    expect(workflow).toContain(
      "bun --filter '@arsenstorm/olos' release:verify-published"
    );
  });

  test("keeps the version PR workflow scoped to versioning", () => {
    const workflow = repositoryFile(".github/workflows/release.yml");

    expect(workflow).toContain("changesets/action");
    expect(workflow).toContain("bun run changeset:version");
    expect(workflow).not.toContain("npm publish");
  });

  test("documents compatibility intent for public-facing cleanup", () => {
    const pullRequests = repositoryFile(
      "contributing/repository/pull-request-descriptions.md"
    );

    expect(pullRequests).toContain("state the compatibility intent explicitly");
    expect(pullRequests).toContain("Public behavior unchanged");
  });
});

function repositoryFile(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}
