import { existsSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "./script-paths";

// Guard for scripts that consume dist/ without building it themselves
// (pack:smoke, pack:artifact, test:e2e): a missing build should fail with
// an actionable message instead of a confusing downstream error, without
// re-running the build in CI where it already ran.
const distEntry = join(packageRoot, "dist", "index.js");

if (!existsSync(distEntry)) {
  console.error(
    "dist/ is missing or incomplete — run `bun run build` (in olos/) first"
  );
  process.exit(1);
}
