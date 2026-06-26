import { rm } from "node:fs/promises";
import { join } from "node:path";
import { isCliEntry } from "./script-entry";
import { packageRoot } from "./script-paths";

const distDirectory = join(packageRoot, "dist");

if (isCliEntry(import.meta.url)) {
  await cleanDist();
}

export async function cleanDist(directory = distDirectory): Promise<void> {
  await rm(directory, {
    force: true,
    recursive: true,
  });
}
