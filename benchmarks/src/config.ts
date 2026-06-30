// Env-driven config + derived constants for a single worker session. Pure
// module — read at import time. Worker mode (when `OLOS_BENCH_WORKER_ID` is
// set) suppresses the live UI and emits one JSON line per sample to stdout.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const FPS = Number(process.env.OLOS_BENCH_FPS ?? 30);
export const TARGET_SAMPLES = Number(process.env.OLOS_BENCH_SAMPLES ?? 1000);
export const SEGMENT_MS = Number(process.env.OLOS_BENCH_SEGMENT_MS ?? 500);
export const PART_MS = Number(process.env.OLOS_BENCH_PART_MS ?? 100);
export const CRF = Number(process.env.OLOS_BENCH_CRF ?? 18);
export const PORT = Number(process.env.OLOS_BENCH_PORT ?? 8799);
export const DECODE_CONCURRENCY = Number(
  process.env.OLOS_BENCH_DECODE_CONCURRENCY ?? 4
);

const SEGMENT_SECONDS = SEGMENT_MS / 1000;
export const usingParts = PART_MS > 0 && PART_MS < SEGMENT_MS;
if (usingParts && SEGMENT_MS % PART_MS !== 0) {
  throw new Error(
    `OLOS_BENCH_SEGMENT_MS (${SEGMENT_MS}) must be a multiple of OLOS_BENCH_PART_MS (${PART_MS})`
  );
}
export const PARTS_PER_SEGMENT = usingParts
  ? Math.round(SEGMENT_MS / PART_MS)
  : 1;
export const FRAGMENT_SECONDS = usingParts ? PART_MS / 1000 : SEGMENT_SECONDS;
export const FRAGMENT_MS = FRAGMENT_SECONDS * 1000;

export const WORKER_ID = process.env.OLOS_BENCH_WORKER_ID;
export const IS_WORKER = WORKER_ID !== undefined;
export const RUN_ID = process.env.OLOS_BENCH_RUN_ID ?? new Date().toISOString();
export const HAS_TTY = process.stdout.isTTY === true;
export const SHOW_LIVE_UI = HAS_TTY && !IS_WORKER;

export const POLL_MS = 25;
export const TELEMETRY_INTERVAL_MS = 250;
export const CHART_WINDOW = 80;
export const CHART_HEIGHT = 10;
export const PLAIN_LOG_INTERVAL_SAMPLES = 50;

export const INIT_FILE = "init.mp4";
export const PART_FILE = /^part-(\d+)\.m4s$/;
export const MEDIA_SEQUENCE = /#EXT-X-MEDIA-SEQUENCE:(\d+)/;
export const MAP_URI = /#EXT-X-MAP:URI="([^"]+)"/;
export const EXT_X_PART_URI = /^#EXT-X-PART:.*URI="([^"]+)"/;

export const CSV_PATH = join(__dirname, "..", "results.csv");
export const RUNS_DIR = join(__dirname, "..", "runs");
export const CSV_HEADER =
  "runId,workerId,seq,msn,partNumber,captureAt,uploadedAt,committedAt,playlistVisibleAt,renderedAt,latencyMs\n";

export const STARTED_AT = new Date().toISOString();

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// High-resolution wall-clock timestamp in fractional milliseconds.
// `performance.now()` carries sub-microsecond resolution; adding `timeOrigin`
// keeps the value on the same epoch as the barcode capture clock (so it stays
// subtractable from `captureAt`) while dropping the integer-ms quantization of
// `Date.now()`. This is the precision floor for the in-process stages.
//
// ponytail: fractional ms, not epoch-ns. True nanoseconds can't ride the
// measurement path — `captureAt` is carried through the H.264 frame as a
// barcode integer decoded into a JS double, and epoch-ns (~1.8e18) exceeds
// Number.MAX_SAFE_INTEGER (9.0e15). For ns on the capture leg, widen the
// barcode to BigInt + ~62 bits (barcode.ts) — but that leg is dominated by
// fragment fill, so the precision would be noise.
export const now = (): number => performance.timeOrigin + performance.now();
