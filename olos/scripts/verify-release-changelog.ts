import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };
import { hasVersionHeading } from "./changelog";

const version = process.env.OLOS_RELEASE_VERSION ?? packageJson.version;

if (version !== "0.0.0") {
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const changelogPath = join(dirname(packageRoot), "CHANGELOG.md");
  const changelog = await readFile(changelogPath, "utf8");

  if (!hasVersionHeading(changelog, version)) {
    throw new Error(`CHANGELOG.md must include a section for ${version}`);
  }
}
