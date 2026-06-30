// Orchestrator's live UI: MultiBar (one row per worker) under an aggregate
// asciichart of the OLOS-slice latency. Non-TTY mode prints a plain log line
// every N samples instead. The slice window is fed by worker JSON messages
// (see orchestrator-worker.ts).

import { plot } from "asciichart";
import cliProgress from "cli-progress";
import {
  CHART_HEIGHT,
  CHART_WINDOW,
  CONCURRENCY,
  HAS_TTY,
  PART_MS,
  PLAIN_LOG_INTERVAL_SAMPLES,
  TARGET_SAMPLES,
  TELEMETRY_INTERVAL_MS,
} from "./orchestrator-config";
import type { WorkerStatus } from "./orchestrator-worker";
import { percentile } from "./stats";

const sliceWindow: number[] = [];
let lastRender = 0;

export const multibar = HAS_TTY
  ? new cliProgress.MultiBar(
      {
        barCompleteChar: "█",
        barIncompleteChar: "░",
        clearOnComplete: false,
        format:
          "  [{bar}] {name} | {value}/{total} ({percentage}%) | p50 {p50}ms p95 {p95}ms",
        forceRedraw: true,
        hideCursor: true,
      },
      cliProgress.Presets.shades_classic
    )
  : undefined;

const bars: cliProgress.SingleBar[] = [];

export function createWorkerBar(workerId: number, samples: number): void {
  if (multibar === undefined) {
    return;
  }
  bars.push(
    multibar.create(samples, 0, { name: `w${workerId}`, p50: "—", p95: "—" })
  );
}

export function recordSlice(olosSliceMs: number): void {
  sliceWindow.push(olosSliceMs);
  if (sliceWindow.length > CHART_WINDOW * 4) {
    sliceWindow.shift();
  }
}

export function renderPanel(workers: readonly WorkerStatus[]): void {
  const now = Date.now();
  if (now - lastRender < TELEMETRY_INTERVAL_MS) {
    return;
  }
  lastRender = now;

  if (HAS_TTY && multibar !== undefined) {
    renderTtyPanel(workers);
    return;
  }
  renderPlainLog(workers);
}

function renderTtyPanel(workers: readonly WorkerStatus[]): void {
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write(
    `OLOS bench — ${CONCURRENCY} worker${CONCURRENCY > 1 ? "s" : ""}, ${PART_MS}ms parts, target ${TARGET_SAMPLES} samples\n\n`
  );
  process.stdout.write(
    "Aggregate OLOS-slice latency (renderedAt − uploadedAt), ms:\n"
  );
  const window = sliceWindow.slice(-CHART_WINDOW);
  if (window.length >= 2) {
    process.stdout.write(
      `${plot(window, {
        format: (n) => n.toFixed(0).padStart(6, " "),
        height: CHART_HEIGHT,
      })}\n\n`
    );
  } else {
    process.stdout.write("(waiting for samples…)\n\n");
  }
  for (let i = 0; i < workers.length; i += 1) {
    const worker = workers[i];
    const bar = bars[i];
    if (worker === undefined || bar === undefined) {
      continue;
    }
    const subset = sliceWindow.slice(-Math.max(50, worker.samples));
    const sortedSubset = [...subset].sort((a, b) => a - b);
    bar.update(worker.samples, {
      p50:
        sortedSubset.length === 0
          ? "—"
          : Math.round(percentile(sortedSubset, 0.5)),
      p95:
        sortedSubset.length === 0
          ? "—"
          : Math.round(percentile(sortedSubset, 0.95)),
    });
  }
}

function renderPlainLog(workers: readonly WorkerStatus[]): void {
  const totalSamples = workers.reduce((s, w) => s + w.samples, 0);
  if (totalSamples % PLAIN_LOG_INTERVAL_SAMPLES !== 0) {
    return;
  }
  const sorted = [...sliceWindow].sort((a, b) => a - b);
  const p50 = sorted.length === 0 ? 0 : Math.round(percentile(sorted, 0.5));
  const p95 = sorted.length === 0 ? 0 : Math.round(percentile(sorted, 0.95));
  console.log(
    `[bench] ${totalSamples}/${TARGET_SAMPLES}  olos-slice p50 ${p50}ms p95 ${p95}ms`
  );
}
