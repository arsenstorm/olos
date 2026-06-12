import { describe, expect, test } from "bun:test";
import { hasVersionHeading, releaseNotes } from "./changelog";

const changelog = `# Changelog

## Unreleased

- No unreleased changes.

## [0.1.0] - 2026-06-12

- Added runtime helpers.
- Added S3 helpers.

## 0.0.1

- Initial package.
`;

describe("release changelog helpers", () => {
  test("finds plain and linked version headings", () => {
    expect(hasVersionHeading(changelog, "0.1.0")).toBe(true);
    expect(hasVersionHeading(changelog, "0.0.1")).toBe(true);
    expect(hasVersionHeading(changelog, "9.9.9")).toBe(false);
  });

  test("extracts release notes from a version section", () => {
    expect(releaseNotes(changelog, "0.1.0")).toBe(
      "- Added runtime helpers.\n- Added S3 helpers.\n"
    );
  });

  test("rejects missing or empty release sections", () => {
    expect(() => releaseNotes(changelog, "9.9.9")).toThrow(
      "CHANGELOG.md must include a section for 9.9.9"
    );
    expect(() => releaseNotes("## 1.0.0\n", "1.0.0")).toThrow(
      "CHANGELOG.md section for 1.0.0 is empty"
    );
  });
});
