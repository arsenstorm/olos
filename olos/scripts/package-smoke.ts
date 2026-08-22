import { mkdir, readFile, rm } from "node:fs/promises";
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

// `./s3` needs `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, but
// they are optional peer dependencies, so npm/bun never install them
// alongside the tarball on their own — install them explicitly, at the
// versions the package itself declares, so the smoke run exercises `./s3`.
async function optionalPeerDependencySpecs(): Promise<string[]> {
  const manifest = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8")
  ) as { peerDependencies?: Record<string, string> };
  const peers = manifest.peerDependencies ?? {};

  return Object.entries(peers).map(([name, range]) => `${name}@${range}`);
}

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
