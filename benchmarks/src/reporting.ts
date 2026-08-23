// Per-sample CSV append + per-run sidecar JSON + end-of-run text report.
// In worker mode, the report is suppressed (orchestrator prints the
// aggregate); the sidecar is still written so the parent can read it.

import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CSV_HEADER,
  CSV_PATH,
  FPS,
  FRAGMENT_MS,
  IS_WORKER,
  PART_MS,
  PARTS_PER_SEGMENT,
  RUN_ID,
  RUNS_DIR,
  SEGMENT_MS,
  SHOW_LIVE_UI,
  STARTED_AT,
  TARGET_SAMPLES,
  usingParts,
  WORKER_ID,
} from "./config";
import type { FinalSample } from "./decoder-pool";
import {
  hostLine,
  printBenchNote,
  printLatencySummary,
  printStages,
} from "./report-sections";
import { gitCommit, machineInfo } from "./run-metadata";
import { aggregate } from "./stats";

export async function ensureCsv(): Promise<void> {
  if (!existsSync(CSV_PATH)) {
    await writeFile(CSV_PATH, CSV_HEADER);
  }
}

export async function appendCsvRow(s: FinalSample): Promise<void> {
  await appendFile(
    CSV_PATH,
    `${RUN_ID},${WORKER_ID ?? ""},${s.seq},${s.msn},${s.partNumber},${s.captureAt},${s.uploadedAt},${s.committedAt},${s.playlistVisibleAt},${s.renderedAt},${s.latencyMs}\n`
  );
}

export async function writeSidecar(
  samples: readonly FinalSample[]
): Promise<string> {
  await mkdir(RUNS_DIR, { recursive: true });
  const path = join(RUNS_DIR, `${RUN_ID.replace(/[:]/g, "-")}.json`);
  const sidecar = {
    config: {
      cmd: process.argv.join(" "),
      concurrency: Number(process.env.OLOS_BENCH_CONCURRENCY ?? 1),
      fps: FPS,
      partMs: PART_MS,
      samplesTarget: TARGET_SAMPLES,
      segmentMs: SEGMENT_MS,
      workerId: WORKER_ID ?? null,
    },
    endedAt: new Date().toISOString(),
    machine: machineInfo(),
    ...(gitCommit() === undefined ? {} : { olosCommit: gitCommit() }),
    results: aggregate(samples),
    runId: RUN_ID,
    startedAt: STARTED_AT,
  };
  await writeFile(path, `${JSON.stringify(sidecar, null, 2)}\n`);
  return path;
}

interface WorkerDoneMessage {
  interrupted: boolean;
  sampleCount: number;
  sidecarPath: string;
}

export function emitDone(sampleCount: number, sidecarPath: string): void {
  emitWorkerDone({ interrupted: false, sampleCount, sidecarPath });
}

export function emitInterrupted(
  sampleCount: number,
  sidecarPath: string
): void {
  emitWorkerDone({ interrupted: true, sampleCount, sidecarPath });
}

function emitWorkerDone(message: WorkerDoneMessage): void {
  if (!IS_WORKER) {
    return;
  }
  process.stdout.write(
    `${JSON.stringify({
      interrupted: message.interrupted,
      samples: message.sampleCount,
      sidecarPath: message.sidecarPath,
      type: "done",
      workerId: WORKER_ID,
    })}\n`
  );
}

export function report(
  samples: readonly FinalSample[],
  sidecarPath: string
): void {
  if (samples.length === 0) {
    console.log("[bench] no samples measured");
    return;
  }
  const results = aggregate(samples);
  const mode = usingParts
    ? `parts (${PARTS_PER_SEGMENT}/segment)`
    : "segments only";

  if (SHOW_LIVE_UI) {
    process.stdout.write("\x1b[2J\x1b[H");
  }
  console.log(
    `OLOS end-to-end benchmark (real H.264 over OLOS, local-only)${IS_WORKER ? ` — worker ${WORKER_ID}` : ""}`
  );
  console.log(hostLine());
  console.log(`  source            : ${FPS} fps`);
  console.log(`  mode              : ${mode}`);
  console.log(`  fragment duration : ${FRAGMENT_MS.toFixed(0)} ms`);
  console.log(
    `  samples measured  : ${results.samples} (target ${TARGET_SAMPLES})`
  );
  console.log("");
  printLatencySummary(results, FRAGMENT_MS);
  printStages(results);
  printBenchNote();
  console.log(`Per-sample CSV : ${CSV_PATH}`);
  console.log(`Sidecar JSON   : ${sidecarPath}`);
  console.log("");
}
