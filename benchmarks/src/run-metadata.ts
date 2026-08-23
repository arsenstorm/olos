// Run provenance shared by the per-worker sidecar and the aggregate sidecar:
// the OLOS commit the bench ran against and the machine it ran on.

import { spawnSync } from "node:child_process";
import os from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface MachineInfo {
  arch: string;
  bun: string;
  cpuCount: number;
  cpuModel: string;
  node: string;
  platform: string;
  totalMemMb: number;
}

export function machineInfo(): MachineInfo {
  return {
    arch: os.arch(),
    bun: process.versions.bun ?? "",
    cpuCount: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? "",
    node: process.versions.node ?? "",
    platform: os.platform(),
    totalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
  };
}

export function gitCommit(): string | undefined {
  try {
    const result = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: __dirname,
      encoding: "utf8",
    });
    if (result.status === 0) {
      return result.stdout.trim();
    }
  } catch {
    // not a git checkout
  }
}
