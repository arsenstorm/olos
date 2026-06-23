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

const acceptedHeadingCases = [
  {
    heading: "## 1.2.3",
    label: "exact plain version heading",
    note: "Added exact plain heading support.",
  },
  {
    heading: "## 1.2.3 - 2026-06-23",
    label: "dated plain version heading",
    note: "Added dated plain heading support.",
  },
  {
    heading: "## [1.2.3]",
    label: "exact linked version heading",
    note: "Added exact linked heading support.",
  },
  {
    heading: "## [1.2.3] - 2026-06-23",
    label: "dated linked version heading",
    note: "Added dated linked heading support.",
  },
] as const;

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

  for (const headingCase of acceptedHeadingCases) {
    test(`extracts release notes from ${headingCase.label}`, () => {
      const source = `# Changelog

${headingCase.heading}

- ${headingCase.note}
`;

      expect(hasVersionHeading(source, "1.2.3")).toBe(true);
      expect(releaseNotes(source, "1.2.3")).toBe(
        releaseNoteBullet(headingCase.note)
      );
    });
  }

  test("rejects missing or empty release sections", () => {
    expect(() => releaseNotes(changelog, "9.9.9")).toThrow(
      "CHANGELOG.md must include a section for 9.9.9"
    );
    expect(() => releaseNotes("## 1.0.0\n", "1.0.0")).toThrow(
      "CHANGELOG.md section for 1.0.0 is empty"
    );
  });
});

function releaseNoteBullet(note: string): string {
  return `- ${note}\n`;
}
