// Live progress: chart of OLOS-slice latency over the last CHART_WINDOW
// samples + cli-progress bar with p50/p95/p99. In worker mode, the same
// signal is emitted as a one-line JSON message per sample for the
// orchestrator to aggregate. In non-TTY mode, a plain log every N samples.

import { plot } from "asciichart";
import cliProgress from "cli-progress";
import {
  CHART_HEIGHT,
  CHART_WINDOW,
  IS_WORKER,
  PART_MS,
  PLAIN_LOG_INTERVAL_SAMPLES,
  SHOW_LIVE_UI,
  TARGET_SAMPLES,
  TELEMETRY_INTERVAL_MS,
  WORKER_ID,
} from "./config";
import type { DecoderInput } from "./decoder-pool";
import { percentile } from "./stats";

const sliceWindow: number[] = [];
let lastTelemetry = 0;
let barStarted = false;

const bar = new cliProgress.SingleBar(
  {
    barCompleteChar: "█",
    barIncompleteChar: "░",
    format:
      "  [{bar}] {value}/{total} ({percentage}%) | olos-slice p50 {p50}ms p95 {p95}ms p99 {p99}ms",
    forceRedraw: true,
    hideCursor: true,
  },
  cliProgress.Presets.shades_classic
);

export function emitProgress(sample: DecoderInput): void {
  sliceWindow.push(sample.renderedAt - sample.uploadedAt);
  if (sliceWindow.length > CHART_WINDOW * 2) {
    sliceWindow.shift();
  }

  if (IS_WORKER) {
    process.stdout.write(
      `${JSON.stringify({
        type: "slice",
        workerId: WORKER_ID,
        seq: sample.seq,
        olosSliceMs: sample.renderedAt - sample.uploadedAt,
      })}\n`
    );
    return;
  }

  const now = Date.now();
  if (now - lastTelemetry < TELEMETRY_INTERVAL_MS) {
    return;
  }
  lastTelemetry = now;
  if (SHOW_LIVE_UI) {
    renderTelemetry(sample.seq + 1);
    return;
  }
  if ((sample.seq + 1) % PLAIN_LOG_INTERVAL_SAMPLES === 0) {
    const sorted = [...sliceWindow].sort((a, b) => a - b);
    console.log(
      `[bench] ${sample.seq + 1}/${TARGET_SAMPLES}  olos-slice p50 ${Math.round(percentile(sorted, 0.5))}ms p95 ${Math.round(percentile(sorted, 0.95))}ms`
    );
  }
}

export function stopProgressBar(): void {
  if (SHOW_LIVE_UI && barStarted) {
    bar.stop();
  }
}

function renderTelemetry(samplesEmitted: number): void {
  const window = sliceWindow.slice(-CHART_WINDOW);
  const sorted = [...sliceWindow].sort((a, b) => a - b);
  const p50 = sorted.length === 0 ? 0 : Math.round(percentile(sorted, 0.5));
  const p95 = sorted.length === 0 ? 0 : Math.round(percentile(sorted, 0.95));
  const p99 = sorted.length === 0 ? 0 : Math.round(percentile(sorted, 0.99));

  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write(
    `OLOS bench — ${PART_MS}ms parts, target ${TARGET_SAMPLES} samples\n\n`
  );
  process.stdout.write("OLOS-slice latency (renderedAt − uploadedAt), ms:\n");
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

  if (barStarted) {
    bar.update(samplesEmitted, { p50, p95, p99 });
  } else {
    bar.start(TARGET_SAMPLES, samplesEmitted, { p50, p95, p99 });
    barStarted = true;
  }
}
