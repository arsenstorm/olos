export function hasVersionHeading(
  changelog: string,
  releaseVersion: string
): boolean {
  return (
    findVersionHeadingIndex(changelogLines(changelog), releaseVersion) !== -1
  );
}

export function releaseNotes(
  changelog: string,
  releaseVersion: string
): string {
  const lines = changelogLines(changelog);
  const headingIndex = requireVersionHeadingIndex(lines, releaseVersion);
  const sectionLines = releaseNoteSectionLines(lines, headingIndex).trim();

  assertReleaseNoteSectionIsNotEmpty(sectionLines, releaseVersion);

  return `${sectionLines}\n`;
}

function requireVersionHeadingIndex(
  lines: readonly string[],
  releaseVersion: string
): number {
  const headingIndex = findVersionHeadingIndex(lines, releaseVersion);

  if (headingIndex === -1) {
    throw new Error(
      `CHANGELOG.md must include a section for ${releaseVersion}`
    );
  }

  return headingIndex;
}

function releaseNoteSectionLines(
  lines: readonly string[],
  headingIndex: number
): string {
  const range = releaseNoteSectionRange(lines, headingIndex);

  return lines.slice(range.start, range.end).join("\n");
}

function assertReleaseNoteSectionIsNotEmpty(
  sectionLines: string,
  releaseVersion: string
): void {
  if (sectionLines === "") {
    throw new Error(`CHANGELOG.md section for ${releaseVersion} is empty`);
  }
}

function changelogLines(changelog: string): string[] {
  return changelog.split("\n");
}

function findVersionHeadingIndex(
  lines: readonly string[],
  releaseVersion: string
): number {
  return lines.findIndex((line) => isVersionHeading(line, releaseVersion));
}

function findNextSectionHeadingIndex(
  lines: readonly string[],
  headingIndex: number
): number {
  return lines.findIndex(
    (line, index) => index > headingIndex && line.startsWith("## ")
  );
}

function releaseNoteSectionRange(
  lines: readonly string[],
  headingIndex: number
): { end?: number; start: number } {
  const nextHeadingIndex = findNextSectionHeadingIndex(lines, headingIndex);

  return {
    end: nextHeadingIndex === -1 ? undefined : nextHeadingIndex,
    start: headingIndex + 1,
  };
}

function isVersionHeading(line: string, releaseVersion: string): boolean {
  return versionHeadingPrefixes(releaseVersion).some((heading) =>
    isExactOrDatedHeading(line, heading)
  );
}

function versionHeadingPrefixes(releaseVersion: string): string[] {
  return [`## ${releaseVersion}`, `## [${releaseVersion}]`];
}

function isExactOrDatedHeading(line: string, heading: string): boolean {
  return line === heading || line.startsWith(`${heading} - `);
}
