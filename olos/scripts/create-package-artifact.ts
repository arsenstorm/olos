import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { packageArtifactPath } from "./package-artifact";
import { packageRoot, repoRoot } from "./script-paths";

const artifactRoot = join(repoRoot, "out", "package-artifacts");
const artifactPath = packageArtifactPath(artifactRoot, packageJson.version);

await rm(artifactRoot, { force: true, recursive: true });
await mkdir(artifactRoot, { recursive: true });
await run("bun", ["pm", "pack", "--filename", artifactPath]);

async function run(command: string, args: readonly string[]): Promise<void> {
  const child = spawn(command, args, {
    cwd: packageRoot,
    stdio: "inherit",
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });

  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${exitCode}`);
  }
}
