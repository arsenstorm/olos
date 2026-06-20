import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const repoRoot = dirname(packageRoot);
