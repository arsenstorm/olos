import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { packageArtifactPath } from "./package-artifact";
import { packageRoot, repoRoot } from "./script-paths";
import { runCommand } from "./script-runner";

const artifactRoot = join(repoRoot, "out", "package-artifacts");
const artifactPath = packageArtifactPath(artifactRoot, packageJson.version);

await rm(artifactRoot, { force: true, recursive: true });
await mkdir(artifactRoot, { recursive: true });
await runCommand("bun", ["pm", "pack", "--filename", artifactPath], {
  cwd: packageRoot,
});
