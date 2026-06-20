import { readFile } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { hasVersionHeading } from "./changelog";
import { repoRoot } from "./script-paths";

const version = process.env.OLOS_RELEASE_VERSION ?? packageJson.version;

if (version !== "0.0.0") {
  const changelogPath = join(repoRoot, "CHANGELOG.md");
  const changelog = await readFile(changelogPath, "utf8");

  if (!hasVersionHeading(changelog, version)) {
    throw new Error(`CHANGELOG.md must include a section for ${version}`);
  }
}
