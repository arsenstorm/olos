import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";

// One-shot reset for the local example stack. Wipes the MinIO volume
// (every uploaded init/part/segment object) and the Worker's Durable
// Object state (every session snapshot), then brings MinIO back up.
//
// Stop `bun run dev` / `vite dev` BEFORE running this — wrangler holds
// open file handles on `.wrangler/state` that block the rm.

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

console.log("→ docker compose down -v");
await run("docker", ["compose", "down", "-v"]);

console.log("→ rm -rf .wrangler/state");
await rm(".wrangler/state", { force: true, recursive: true });

console.log("→ docker compose up -d");
await run("docker", ["compose", "up", "-d"]);

console.log("reset complete");
