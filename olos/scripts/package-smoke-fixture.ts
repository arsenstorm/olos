import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { packageSmokeSource } from "./package-smoke-runtime";
import {
  packageTypeSmokeConfig,
  packageTypeSmokeSource,
} from "./package-smoke-types";

export async function writePackageSmokeFile(root: string): Promise<void> {
  await writeFile(join(root, "smoke.mjs"), packageSmokeSource());
  await writeFile(join(root, "smoke.ts"), packageTypeSmokeSource());
  await writeFile(join(root, "tsconfig.json"), packageTypeSmokeConfig());
}
