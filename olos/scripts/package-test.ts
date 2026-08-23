import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { which } from "bun";
import { packageRoot, repoRoot } from "./script-paths";
import { runCommand } from "./script-runner";
import {
  optionalPeerDependencySpecs,
  testRuntime,
  writeTestConsumerFiles,
} from "./test-consumer";

const workRoot = join(repoRoot, "out", "package-test");
const tarball = join(workRoot, "olos-test.tgz");
const consumerRoot = join(workRoot, "consumer");

await rm(workRoot, { force: true, recursive: true });
await mkdir(consumerRoot, { recursive: true });

await runCommand("bun", ["pm", "pack", "--filename", tarball, "--quiet"], {
  cwd: packageRoot,
});
await writeTestConsumerFiles(consumerRoot);
await installTarball();
await runCommand(testRuntime(), ["test.mjs"], { cwd: consumerRoot });

// Prefer npm so the tarball resolves the way real consumers install it; npm
// is unavailable on bun-only machines, where `bun add` covers the same
// dependency-resolution ground.
async function installTarball(): Promise<void> {
  const npm = which("npm");
  const peerSpecs = await optionalPeerDependencySpecs();

  if (npm === null) {
    await runCommand("bun", ["add", tarball, ...peerSpecs], {
      cwd: consumerRoot,
    });
    return;
  }

  await runCommand(
    npm,
    ["install", "--no-audit", "--no-fund", tarball, ...peerSpecs],
    { cwd: consumerRoot }
  );
}
