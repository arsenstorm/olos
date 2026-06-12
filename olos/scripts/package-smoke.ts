import { spawn } from "node:child_process";
import { mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writePackageSmokeFile } from "./package-smoke-fixture";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(packageRoot);
const workRoot = join(repoRoot, "out", "package-smoke");
const tarball = join(workRoot, "olos-smoke.tgz");
const consumerRoot = join(workRoot, "consumer");
const consumerNodeModules = join(consumerRoot, "node_modules");
const packageInstallRoot = join(consumerNodeModules, "olos");
const tempRoot = join(workRoot, "tmp");

await rm(workRoot, { force: true, recursive: true });
await mkdir(tempRoot, { recursive: true });
await mkdir(packageInstallRoot, { recursive: true });

await run("bun", ["pm", "pack", "--filename", tarball, "--quiet"]);
await run("tar", [
  "-xzf",
  tarball,
  "--strip-components",
  "1",
  "-C",
  packageInstallRoot,
]);
await linkPackageDependencies();

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
await writePackageSmokeFile(consumerRoot);

await run("bun", ["smoke.mjs"], { cwd: consumerRoot });

async function linkPackageDependencies() {
  const packageNodeModules = join(packageRoot, "node_modules");
  const entries = await readdir(packageNodeModules);

  for (const entry of entries) {
    if (entry === ".bin" || entry === "olos") {
      continue;
    }

    await symlink(
      join(packageNodeModules, entry),
      join(consumerNodeModules, entry),
      "dir"
    );
  }
}

async function run(
  command: string,
  args: readonly string[],
  options: { cwd?: string } = {}
) {
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

  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${exitCode}`);
  }
}
