// Cross-worker aggregate: reads the shared CSV filtered by this run's
// runId prefix, computes one AggregateStats, writes the aggregate sidecar
// JSON, prints the cross-worker report.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
import {
  hostLine,
  printBenchNote,
  printLatencySummary,
  printStages,
} from "./report-sections";
import { gitCommit, machineInfo } from "./run-metadata";
import { type AggregateInput, type AggregateStats, aggregate } from "./stats";

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
      cmd: process.argv.join(" "),
      concurrency: CONCURRENCY,
      fps: FPS,
      partMs: PART_MS,
      samplesTarget: TARGET_SAMPLES,
      segmentMs: SEGMENT_MS,
    },
    endedAt: new Date().toISOString(),
    machine: machineInfo(),
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
  const fragmentMs = PART_MS > 0 && PART_MS < SEGMENT_MS ? PART_MS : SEGMENT_MS;

  if (HAS_TTY) {
    process.stdout.write("\x1b[2J\x1b[H");
  }
  console.log("OLOS end-to-end benchmark — aggregate across workers");
  console.log(hostLine());
  console.log(`  concurrency       : ${CONCURRENCY}`);
  console.log(`  fragment duration : ${fragmentMs} ms`);
  console.log(
    `  samples measured  : ${results.samples} (target ${TARGET_SAMPLES})`
  );
  console.log("");
  printLatencySummary(results, fragmentMs);
  printStages(results);
  printBenchNote();
  if (CONCURRENCY > 1) {
    printPerWorker(workerStatuses);
  }
  console.log(`Per-sample CSV   : ${CSV_PATH}`);
  console.log(`Aggregate sidecar: ${sidecarPath}`);
  console.log("");
}

function printPerWorker(workerStatuses: readonly WorkerStatus[]): void {
  console.log("Per-worker:");
  for (const w of workerStatuses) {
    console.log(
      `  ${w.runId}: ${w.samples}/${w.target}${w.interrupted ? " (interrupted)" : ""}`
    );
  }
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
