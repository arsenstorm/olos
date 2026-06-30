// Cross-worker aggregate: reads the shared CSV filtered by this run's
// runId prefix, computes one AggregateStats, writes the aggregate sidecar
// JSON, prints the cross-worker report.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONCURRENCY,
  CSV_PATH,
  FPS,
  HAS_TTY,
  PART_MS,
  RUN_ID,
  RUNS_DIR,
  SEGMENT_MS,
  STARTED_AT,
  TARGET_SAMPLES,
} from "./orchestrator-config";
import type { WorkerStatus } from "./orchestrator-worker";
import { type AggregateInput, type AggregateStats, aggregate } from "./stats";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CsvRow extends AggregateInput {
  runId: string;
}

export async function readRunRows(runPrefix: string): Promise<CsvRow[]> {
  if (!existsSync(CSV_PATH)) {
    return [];
  }
  const text = await readFile(CSV_PATH, "utf8");
  const lines = text.split("\n");
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || line.length === 0) {
      continue;
    }
    const cols = line.split(",");
    if (cols.length < 11 || !cols[0]?.startsWith(runPrefix)) {
      continue;
    }
    rows.push({
      captureAt: Number(cols[5]),
      committedAt: Number(cols[7]),
      latencyMs: Number(cols[10]),
      playlistVisibleAt: Number(cols[8]),
      renderedAt: Number(cols[9]),
      runId: cols[0],
      uploadedAt: Number(cols[6]),
    });
  }
  return rows;
}

export async function writeAggregateSidecar(
  results: AggregateStats,
  workerStatuses: readonly WorkerStatus[]
): Promise<string> {
  await mkdir(RUNS_DIR, { recursive: true });
  const path = join(RUNS_DIR, `${RUN_ID.replace(/[:]/g, "-")}-aggregate.json`);
  const sidecar = {
    config: {
      concurrency: CONCURRENCY,
      cmd: process.argv.join(" "),
      fps: FPS,
      partMs: PART_MS,
      samplesTarget: TARGET_SAMPLES,
      segmentMs: SEGMENT_MS,
    },
    endedAt: new Date().toISOString(),
    machine: {
      arch: os.arch(),
      bun: process.versions.bun ?? "",
      cpuCount: os.cpus().length,
      cpuModel: os.cpus()[0]?.model ?? "",
      node: process.versions.node ?? "",
      platform: os.platform(),
      totalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
    },
    ...(gitCommit() === undefined ? {} : { olosCommit: gitCommit() }),
    results,
    runId: RUN_ID,
    startedAt: STARTED_AT,
    workers: workerStatuses.map((w) => ({
      interrupted: w.interrupted,
      runId: w.runId,
      samples: w.samples,
      sidecarPath: w.sidecarPath ?? null,
      target: w.target,
    })),
  };
  await writeFile(path, `${JSON.stringify(sidecar, null, 2)}\n`);
  return path;
}

export function printAggregateReport(
  results: AggregateStats,
  sidecarPath: string,
  workerStatuses: readonly WorkerStatus[]
): void {
  const fmt = (ms: number) => `${ms.toFixed(3)} ms`;
  const fragmentMs = PART_MS > 0 && PART_MS < SEGMENT_MS ? PART_MS : SEGMENT_MS;
  const overheadMs = Math.max(0, results.p50 - fragmentMs);

  if (HAS_TTY) {
    process.stdout.write("\x1b[2J\x1b[H");
  }
  console.log("OLOS end-to-end benchmark — aggregate across workers");
  console.log(
    `  host              : ${os.platform()} ${os.arch()} ${os.cpus()[0]?.model ?? "?"}`
  );
  console.log(`  concurrency       : ${CONCURRENCY}`);
  console.log(`  fragment duration : ${fragmentMs} ms`);
  console.log(
    `  samples measured  : ${results.samples} (target ${TARGET_SAMPLES})`
  );
  console.log("");
  console.log("End-to-end latency (renderedAt − captureAt):");
  console.log(`  p50               : ${fmt(results.p50)}`);
  console.log(`  p95               : ${fmt(results.p95)}`);
  console.log(`  p99               : ${fmt(results.p99)}`);
  console.log(`  mean              : ${fmt(results.mean)}`);
  console.log(`  olos overhead p50 : ~${fmt(overheadMs)}  (p50 − fragment ms)`);
  console.log("");
  console.log("Stage breakdown:");
  for (const [name, pct, desc] of [
    [
      "encode fill",
      results.stagePercentiles.encodeFill,
      "uploadedAt − captureAt",
    ],
    ["publish", results.stagePercentiles.publish, "committedAt − uploadedAt"],
    ["wake", results.stagePercentiles.wake, "visibleAt − committedAt"],
    ["fetch", results.stagePercentiles.fetch, "renderedAt − visibleAt"],
  ] as const) {
    console.log(
      `  ${name.padEnd(18)}: p50 ${fmt(pct.p50)}  p95 ${fmt(pct.p95)}  (${desc})`
    );
  }
  console.log("");
  console.log(
    "Note: `publish` tail in this single-process bench reflects JS event-loop"
  );
  console.log(
    "contention between producer and consumer sharing the same handler — see"
  );
  console.log("README for why production deploys don't see this term.");
  console.log("");
  if (CONCURRENCY > 1) {
    console.log("Per-worker:");
    for (const w of workerStatuses) {
      console.log(
        `  ${w.runId}: ${w.samples}/${w.target}${w.interrupted ? " (interrupted)" : ""}`
      );
    }
    console.log("");
  }
  console.log(`Per-sample CSV   : ${CSV_PATH}`);
  console.log(`Aggregate sidecar: ${sidecarPath}`);
  console.log("");
}

export async function finalize(
  workerStatuses: readonly WorkerStatus[]
): Promise<void> {
  const rows = await readRunRows(RUN_ID);
  const results = aggregate(rows);
  const sidecarPath = await writeAggregateSidecar(results, workerStatuses);
  printAggregateReport(results, sidecarPath, workerStatuses);
}

function gitCommit(): string | undefined {
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
  return;
}
