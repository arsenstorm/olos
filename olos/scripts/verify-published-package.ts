import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { which } from "bun";
import packageJson from "../package.json" with { type: "json" };
import { assertPublishedPackageVersion } from "./published-package";
import { repoRoot } from "./script-paths";
import { runCommand } from "./script-runner";
import {
  optionalPeerDependencySpecs,
  smokeRuntime,
  writeSmokeConsumerFiles,
} from "./smoke-consumer";

const RETRIES = 12;
const RETRY_DELAY_MS = 5000;

const workRoot = join(repoRoot, "out", "published-package-smoke");
const consumerRoot = join(workRoot, "consumer");
const version = process.argv[2] ?? packageJson.version;

assertPublishedPackageVersion(version);

await rm(workRoot, { force: true, recursive: true });
await mkdir(consumerRoot, { recursive: true });
await writeSmokeConsumerFiles(consumerRoot);

// Retry: registry propagation of a just-published version can lag. The
// optional `@aws-sdk` peers are installed alongside so `./s3` loads.
await installWithRetries(
  `@arsenstorm/olos@${version}`,
  await optionalPeerDependencySpecs()
);
await runCommand(smokeRuntime(), ["smoke.mjs"], { cwd: consumerRoot });

async function installWithRetries(
  specifier: string,
  peerSpecs: readonly string[]
): Promise<void> {
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const result = await installOnce(specifier, peerSpecs);

    if (result === 0) {
      return;
    }

    if (attempt === RETRIES) {
      throw new Error(`install of ${specifier} exited with ${result}`);
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}

function installOnce(
  specifier: string,
  peerSpecs: readonly string[]
): Promise<number | null> {
  const npm = which("npm");

  if (npm === null) {
    return runCommand(
      "bun",
      ["add", "--no-cache", "--exact", specifier, ...peerSpecs],
      {
        cwd: consumerRoot,
        reject: false,
      }
    );
  }

  return runCommand(
    npm,
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--prefer-online",
      "--save-exact",
      specifier,
      ...peerSpecs,
    ],
    { cwd: consumerRoot, reject: false }
  );
}
