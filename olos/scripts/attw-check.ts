import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { resolveWorkspaceBin } from "./script-bin";
import { packageRoot, repoRoot } from "./script-paths";
import { runCommand } from "./script-runner";

// attw's own --pack mode shells out to `npm pack`, which is unavailable on
// bun-only machines — pack with bun and hand attw the tarball instead.
const workRoot = join(repoRoot, "out", "attw");
const tarball = join(workRoot, "olos-attw.tgz");

await rm(workRoot, { force: true, recursive: true });
await mkdir(workRoot, { recursive: true });
await runCommand("bun", ["pm", "pack", "--filename", tarball, "--quiet"], {
  cwd: packageRoot,
});
await runCommand(
  await resolveWorkspaceBin("attw", [packageRoot, repoRoot]),
  [tarball, "--profile", "esm-only"],
  { cwd: packageRoot }
);
