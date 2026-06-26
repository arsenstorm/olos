import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { packageArtifactPath } from "./release-metadata";
import { packageRoot, repoRoot } from "./script-paths";
import { runCommand } from "./script-runner";

const artifactRoot = join(repoRoot, "out", "package-artifacts");
const artifactPath = packageArtifactPath(artifactRoot);

await rm(artifactRoot, { force: true, recursive: true });
await mkdir(artifactRoot, { recursive: true });
await runCommand("bun", ["pm", "pack", "--filename", artifactPath], {
  cwd: packageRoot,
});
