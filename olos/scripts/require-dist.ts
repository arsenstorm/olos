import { existsSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "./script-paths";

// pack:test, pack:artifact and test:e2e consume dist/ without building it:
// fail early with an actionable message rather than a confusing downstream
// error, and never rebuild in CI where the build already ran.
const distEntry = join(packageRoot, "dist", "index.js");

if (!existsSync(distEntry)) {
  console.error(
    "dist/ is missing or incomplete — run `bun run build` (in olos/) first"
  );
  process.exit(1);
}
