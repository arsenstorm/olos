// Per-sample CSV append + per-run sidecar JSON + end-of-run text report.
// In worker mode, the report is suppressed (orchestrator prints the
// aggregate); the sidecar is still written so the parent can read it.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { type AggregateStats, aggregate } from "./stats";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
      concurrency: Number(process.env.OLOS_BENCH_CONCURRENCY ?? 1),
      cmd: process.argv.join(" "),
      fps: FPS,
      partMs: PART_MS,
      samplesTarget: TARGET_SAMPLES,
      segmentMs: SEGMENT_MS,
      workerId: WORKER_ID ?? null,
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
    results: aggregate(samples),
    runId: RUN_ID,
    startedAt: STARTED_AT,
  };
  await writeFile(path, `${JSON.stringify(sidecar, null, 2)}\n`);
  return path;
}

export function emitDone(
  sampleCount: number,
  sidecarPath: string,
  interrupted: boolean
): void {
  if (!IS_WORKER) {
    return;
  }
  process.stdout.write(
    `${JSON.stringify({
      type: "done",
      workerId: WORKER_ID,
      samples: sampleCount,
      sidecarPath,
      interrupted,
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
  const fmt = (ms: number) => `${ms.toFixed(3)} ms`;
  const overheadMs = Math.max(0, results.p50 - FRAGMENT_MS);
  const mode = usingParts
    ? `parts (${PARTS_PER_SEGMENT}/segment)`
    : "segments only";

  if (SHOW_LIVE_UI) {
    process.stdout.write("\x1b[2J\x1b[H");
  }
  console.log(
    `OLOS end-to-end benchmark (real H.264 over OLOS, local-only)${IS_WORKER ? ` — worker ${WORKER_ID}` : ""}`
  );
  console.log(
    `  host              : ${os.platform()} ${os.arch()} ${os.cpus()[0]?.model ?? "?"}`
  );
  console.log(`  source            : ${FPS} fps`);
  console.log(`  mode              : ${mode}`);
  console.log(`  fragment duration : ${FRAGMENT_MS.toFixed(0)} ms`);
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
  printStages(results);
  console.log(
    "Note: `publish` tail in this single-process bench reflects JS event-loop"
  );
  console.log(
    "contention between producer and consumer sharing the same handler — see"
  );
  console.log("README for why production deploys don't see this term.");
  console.log("");
  console.log(`Per-sample CSV : ${CSV_PATH}`);
  console.log(`Sidecar JSON   : ${sidecarPath}`);
  console.log("");
}

export function printStages(results: AggregateStats): void {
  const fmt = (ms: number) => `${ms.toFixed(3)} ms`;
  console.log("Stage breakdown (percentiles per stage):");
  const stages: [string, { p50: number; p95: number }, string][] = [
    [
      "encode fill",
      results.stagePercentiles.encodeFill,
      "uploadedAt − captureAt",
    ],
    ["publish", results.stagePercentiles.publish, "committedAt − uploadedAt"],
    ["wake", results.stagePercentiles.wake, "visibleAt − committedAt"],
    ["fetch", results.stagePercentiles.fetch, "renderedAt − visibleAt"],
  ];
  for (const [name, pct, desc] of stages) {
    console.log(
      `  ${name.padEnd(18)}: p50 ${fmt(pct.p50)}  p95 ${fmt(pct.p95)}  (${desc})`
    );
  }
  console.log("");
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
  return;
}
