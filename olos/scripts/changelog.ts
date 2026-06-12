export function hasVersionHeading(
  changelog: string,
  releaseVersion: string
): boolean {
  return changelog
    .split("\n")
    .some((line) => isVersionHeading(line, releaseVersion));
}

export function releaseNotes(
  changelog: string,
  releaseVersion: string
): string {
  const lines = changelog.split("\n");
  const headingIndex = lines.findIndex((line) =>
    isVersionHeading(line, releaseVersion)
  );

  if (headingIndex === -1) {
    throw new Error(
      `CHANGELOG.md must include a section for ${releaseVersion}`
    );
  }

  const nextHeadingIndex = lines.findIndex(
    (line, index) => index > headingIndex && line.startsWith("## ")
  );
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
