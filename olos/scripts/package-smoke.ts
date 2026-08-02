import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { which } from "bun";
import { packageRoot, repoRoot } from "./script-paths";
import { runCommand } from "./script-runner";
import { smokeRuntime, writeSmokeConsumerFiles } from "./smoke-consumer";

const workRoot = join(repoRoot, "out", "package-smoke");
const tarball = join(workRoot, "olos-smoke.tgz");
const consumerRoot = join(workRoot, "consumer");

await rm(workRoot, { force: true, recursive: true });
await mkdir(consumerRoot, { recursive: true });

await runCommand("bun", ["pm", "pack", "--filename", tarball, "--quiet"], {
  cwd: packageRoot,
});
await writeSmokeConsumerFiles(consumerRoot);
await installTarball();
await runCommand(smokeRuntime(), ["smoke.mjs"], { cwd: consumerRoot });

// Prefer npm so the tarball resolves the way real consumers install it; npm
// is unavailable on bun-only machines, where `bun add` covers the same
// dependency-resolution ground.
async function installTarball(): Promise<void> {
  const npm = which("npm");

  if (npm === null) {
    await runCommand("bun", ["add", tarball], { cwd: consumerRoot });
    return;
  }

  await runCommand(npm, ["install", "--no-audit", "--no-fund", tarball], {
    cwd: consumerRoot,
  });
}
