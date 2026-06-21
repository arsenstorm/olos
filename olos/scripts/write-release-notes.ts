import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { releaseNotes } from "./changelog";
import { releaseVersionFromCli } from "./release-metadata";
import { repoRoot } from "./script-paths";

const version = releaseVersionFromCli();
const notesRoot = join(repoRoot, "out", "release");
const notesPath = join(notesRoot, "notes.md");
const changelog = await readFile(join(repoRoot, "CHANGELOG.md"), "utf8");
const notes = releaseNotes(changelog, version);

await mkdir(notesRoot, { recursive: true });
await writeFile(notesPath, notes);
console.log(notesPath);
