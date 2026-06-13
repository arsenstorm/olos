import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const output = await run("bun", ["pm", "pack", "--dry-run"]);

for (const file of ["dist/index.js", "dist/index.d.ts", "dist/s3.js"]) {
  if (!output.includes(file)) {
    throw new Error(`dry package is missing ${file}; run bun run build first`);
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
