import packageJson from "../package.json" with { type: "json" };
import { isRecord } from "../src/validation/fields";
import { packageExportSubpaths } from "./package-export-map";
import { isCliEntry } from "./script-entry";
import { packageRoot } from "./script-paths";
import { runCommandAndCapture } from "./script-runner";

const requiredDryPackFiles = requiredDryPackFilesFromExports(
  packageJson.exports
);

if (isCliEntry(import.meta.url)) {
  assertDryPackIncludesRequiredFiles(
    await runCommandAndCapture("bun", ["pm", "pack", "--dry-run"], {
      cwd: packageRoot,
    })
  );
}

export function assertDryPackIncludesRequiredFiles(output: string): void {
  for (const file of requiredDryPackFiles) {
    if (!output.includes(file)) {
      throw new Error(
        `dry package is missing ${file}; run bun run build first`
      );
    }
  }
}

export function requiredDryPackFilesFromExports(
  exportsMap: Record<string, unknown>
): string[] {
  const files = new Set<string>();

  for (const subpath of packageExportSubpaths(exportsMap)) {
    const value = exportsMap[subpath];
    addExportFile(files, value, "default");
    addExportFile(files, value, "import");
    addExportFile(files, value, "types");
  }

  return [...files].sort();
}

function addExportFile(
  files: Set<string>,
  value: unknown,
  field: "default" | "import" | "types"
): void {
  if (!isRecord(value)) {
    return;
  }

  const path = value[field];

  if (typeof path === "string" && path.startsWith("./dist/")) {
    files.add(path.slice(2));
  }
}
