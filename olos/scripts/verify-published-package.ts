import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { assertInstalledPackageContents } from "./package-contents";
import { writePackageSmokeFile } from "./package-smoke-fixture";
import { assertPublishedPackageVersion } from "./published-package";
import { packageRoot, repoRoot } from "./script-paths";
import { runCommand } from "./script-runner";

const workRoot = join(repoRoot, "out", "published-package-smoke");
const consumerRoot = join(workRoot, "consumer");
const tempRoot = join(workRoot, "tmp");
const tsc = join(packageRoot, "node_modules", ".bin", "tsc");
const version = process.argv[2] ?? packageJson.version;
const smokeEnv = {
  ...process.env,
  TEMP: tempRoot,
  TMP: tempRoot,
  TMPDIR: tempRoot,
};

assertPublishedPackageVersion(version);

await rm(workRoot, { force: true, recursive: true });
await mkdir(consumerRoot, { recursive: true });
await mkdir(tempRoot, { recursive: true });
await writeFile(
  join(consumerRoot, "package.json"),
  `${JSON.stringify(
    {
      private: true,
      type: "module",
    },
    null,
    2
  )}\n`
);

await runWithRetries("bun", ["add", "--exact", `olos@${version}`], {
  cwd: consumerRoot,
  retries: 12,
});
await assertInstalledPackageContents(
  join(consumerRoot, "node_modules", "olos")
);
await writePackageSmokeFile(consumerRoot);
await run("bun", ["smoke.mjs"], { cwd: consumerRoot });
await run(tsc, ["--project", "tsconfig.json"], { cwd: consumerRoot });

async function runWithRetries(
  command: string,
  args: readonly string[],
  options: { cwd?: string; retries: number }
): Promise<void> {
  for (let attempt = 1; attempt <= options.retries; attempt += 1) {
    const result = await run(command, args, {
      cwd: options.cwd,
      reject: false,
    });

    if (result === 0) {
      return;
    }

    if (attempt === options.retries) {
      throw new Error(`${command} ${args.join(" ")} exited with ${result}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

function run(
  command: string,
  args: readonly string[],
  options: { cwd?: string; reject?: boolean } = {}
): Promise<number | null> {
  return runCommand(command, args, {
    cwd: options.cwd ?? packageRoot,
    env: smokeEnv,
    reject: options.reject,
  });
}
