import packageJson from "../package.json" with { type: "json" };
import { isRecord } from "../src/validation/fields";
import { packageExportSubpaths } from "./package-export-map";
import { isCliEntry } from "./script-entry";
import { packageRoot } from "./script-paths";
import { runCommandAndCapture } from "./script-runner";

const exportFileFields = ["default", "import", "types"] as const;
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

    for (const field of exportFileFields) {
      addExportFile(files, value, field);
    }
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

  const file = distExportFile(path);

  if (file !== undefined) {
    files.add(file);
  }
}

function distExportFile(value: unknown): string | undefined {
  if (!isDistExportPath(value)) {
    return;
  }

  return value.slice(2);
}

function isDistExportPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("./dist/");
}
