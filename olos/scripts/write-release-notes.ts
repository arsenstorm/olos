import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { releaseNotes } from "./changelog";
import { repoRoot } from "./script-paths";

const version =
  process.argv[2] ?? process.env.OLOS_RELEASE_VERSION ?? packageJson.version;
const notesRoot = join(repoRoot, "out", "release");
const notesPath = join(notesRoot, "notes.md");
const changelog = await readFile(join(repoRoot, "CHANGELOG.md"), "utf8");
const notes = releaseNotes(changelog, version);

await mkdir(notesRoot, { recursive: true });
await writeFile(notesPath, notes);
console.log(notesPath);
