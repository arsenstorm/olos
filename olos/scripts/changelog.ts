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
  const headingIndex = findVersionHeadingIndex(lines, releaseVersion);

  if (headingIndex === -1) {
    throw new Error(
      `CHANGELOG.md must include a section for ${releaseVersion}`
    );
  }

  const nextHeadingIndex = findNextSectionHeadingIndex(lines, headingIndex);
  const sectionLines = lines
    .slice(
      headingIndex + 1,
      nextHeadingIndex === -1 ? undefined : nextHeadingIndex
    )
    .join("\n")
    .trim();

  if (sectionLines === "") {
    throw new Error(`CHANGELOG.md section for ${releaseVersion} is empty`);
  }

  return `${sectionLines}\n`;
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

function isVersionHeading(line: string, releaseVersion: string): boolean {
  const plainHeading = `## ${releaseVersion}`;
  const linkedHeading = `## [${releaseVersion}]`;

  return (
    line === plainHeading ||
    line.startsWith(`${plainHeading} - `) ||
    line === linkedHeading ||
    line.startsWith(`${linkedHeading} - `)
  );
}
