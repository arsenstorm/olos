import {
  access,
  mkdir,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { assertInstalledPackageContents } from "./package-contents";
import { writePackageSmokeFile } from "./package-smoke-fixture";
import { packageRoot, repoRoot } from "./script-paths";
import { runCommand } from "./script-runner";

const workRoot = join(repoRoot, "out", "package-smoke");
const tarball = join(workRoot, "olos-smoke.tgz");
const consumerRoot = join(workRoot, "consumer");
const consumerNodeModules = join(consumerRoot, "node_modules");
const packageInstallRoot = join(consumerNodeModules, "olos");
const tempRoot = join(workRoot, "tmp");
const smokeEnv = {
  ...process.env,
  TEMP: tempRoot,
  TMP: tempRoot,
  TMPDIR: tempRoot,
};

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
await assertInstalledPackageContents(packageInstallRoot);
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
await run(await resolveBin("tsc"), ["--project", "tsconfig.json"], {
  cwd: consumerRoot,
});

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

async function resolveBin(name: string): Promise<string> {
  for (const root of [packageRoot, repoRoot]) {
    const candidate = join(root, "node_modules", ".bin", name);

    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `${name} binary not found in package or workspace node_modules`
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function run(
  command: string,
  args: readonly string[],
  options: { cwd?: string } = {}
): Promise<number | null> {
  return runCommand(command, args, {
    cwd: options.cwd ?? packageRoot,
    env: smokeEnv,
  });
}
