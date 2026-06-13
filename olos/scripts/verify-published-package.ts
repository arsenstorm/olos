import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };
import { assertInstalledPackageContents } from "./package-contents";
import { writePackageSmokeFile } from "./package-smoke-fixture";
import { assertPublishedPackageVersion } from "./published-package";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(packageRoot);
const workRoot = join(repoRoot, "out", "published-package-smoke");
const consumerRoot = join(workRoot, "consumer");
const tempRoot = join(workRoot, "tmp");
const tsc = join(packageRoot, "node_modules", ".bin", "tsc");
const version = process.argv[2] ?? packageJson.version;

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

async function run(
  command: string,
  args: readonly string[],
  options: { cwd?: string; reject?: boolean } = {}
): Promise<number | null> {
  const child = spawn(command, args, {
    cwd: options.cwd ?? packageRoot,
    env: {
      ...process.env,
      TEMP: tempRoot,
      TMP: tempRoot,
      TMPDIR: tempRoot,
    },
    stdio: "inherit",
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });

  if (options.reject !== false && exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${exitCode}`);
  }

  return exitCode;
}
