import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requiredDryPackFiles = requiredDryPackFilesFromExports(
  packageJson.exports
);

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  assertDryPackIncludesRequiredFiles(
    await run("bun", ["pm", "pack", "--dry-run"])
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

  for (const [subpath, value] of Object.entries(exportsMap)) {
    if (subpath === "./package.json") {
      continue;
    }

    addExportFile(files, value, "import");
    addExportFile(files, value, "types");
  }

  return [...files].sort();
}

function addExportFile(
  files: Set<string>,
  value: unknown,
  field: "import" | "types"
): void {
  if (!isRecord(value)) {
    return;
  }

  const path = value[field];

  if (typeof path === "string" && path.startsWith("./dist/")) {
    files.add(path.slice(2));
  }
}

async function run(command: string, args: readonly string[]): Promise<string> {
  const child = spawn(command, args, {
    cwd: packageRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(text);
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });

  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${exitCode}`);
  }

  return `${stdout}\n${stderr}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
