// Orchestrator-side env + paths. Distinct module from the worker's
// config.ts because the orchestrator has its own RUN_ID (the parent run)
// and reads its own subset of env (`OLOS_BENCH_CONCURRENCY`).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const CONCURRENCY = Math.max(
  1,
  Number(process.env.OLOS_BENCH_CONCURRENCY ?? 1)
);
export const TARGET_SAMPLES = Number(process.env.OLOS_BENCH_SAMPLES ?? 1000);
export const BASE_PORT = Number(process.env.OLOS_BENCH_PORT ?? 8799);
export const PART_MS = Number(process.env.OLOS_BENCH_PART_MS ?? 100);
export const SEGMENT_MS = Number(process.env.OLOS_BENCH_SEGMENT_MS ?? 500);
export const FPS = Number(process.env.OLOS_BENCH_FPS ?? 30);
export const HAS_TTY = process.stdout.isTTY === true;

export const WORKER_ENTRY = join(__dirname, "index.ts");
export const CSV_PATH = join(__dirname, "..", "results.csv");
export const RUNS_DIR = join(__dirname, "..", "runs");

export const RUN_ID = new Date().toISOString();
export const STARTED_AT = RUN_ID;

export const CHART_WINDOW = 80;
export const CHART_HEIGHT = 10;
export const TELEMETRY_INTERVAL_MS = 250;
export const PLAIN_LOG_INTERVAL_SAMPLES = 50;

export function distributeSamples(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const extra = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}
