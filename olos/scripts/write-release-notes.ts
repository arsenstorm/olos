import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(packageRoot);
const version =
  process.argv[2] ?? process.env.OLOS_RELEASE_VERSION ?? packageJson.version;
const notesRoot = join(repoRoot, "out", "release");
const notesPath = join(notesRoot, "notes.md");
const changelog = await readFile(join(repoRoot, "CHANGELOG.md"), "utf8");
const notes = releaseNotes(changelog, version);

await mkdir(notesRoot, { recursive: true });
await writeFile(notesPath, notes);
console.log(notesPath);

function releaseNotes(changelog: string, releaseVersion: string): string {
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
