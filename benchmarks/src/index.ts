// OLOS end-to-end latency benchmark — single worker session entry.
//
// Wires producer + consumer + streaming decoder pool together, hooks up SIGINT/
// SIGTERM for a clean drain, and routes the final report to either the
// orchestrator (worker mode) or the terminal. See module comments in:
//   config.ts        — env knobs + derived constants
//   session.ts       — producer + consumer
//   decoder-pool.ts  — streaming ffmpeg-decode pool
//   telemetry.ts     — live chart + cli-progress + worker JSON lines
//   reporting.ts     — CSV append + sidecar JSON + text report
//   stats.ts         — percentile + per-stage aggregate
// Run via orchestrator: bun run benchmark.

// Loopback bench only — accept self-signed media-origin cert without wiring
// a trust store. Set BEFORE importing the harness so the harness itself
// stays side-effect-free for any other importer.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFrame } from "./barcode";
import {
  CRF,
  DECODE_CONCURRENCY,
  FPS,
  FRAGMENT_SECONDS,
  IS_WORKER,
  PORT,
} from "./config";
import {
  createDecoderPool,
  type DecoderPool,
  type FinalSample,
} from "./decoder-pool";
import { spawnEncoder } from "./encoder";
import { createLocalOlos, type LocalOlos } from "./local-olos";
import {
  appendCsvRow,
  emitDone,
  ensureCsv,
  report,
  writeSidecar,
} from "./reporting";
import { progress, runConsumer, runProducer } from "./session";
import { stopProgressBar } from "./telemetry";

interface Cleanable {
  encoder?: { kill(signal: NodeJS.Signals): boolean };
  frameTimer?: ReturnType<typeof setInterval>;
  olos?: LocalOlos;
  outDir?: string;
}

const cleanupState: Cleanable = {};
let cleanupRan = false;

async function cleanup(): Promise<void> {
  if (cleanupRan) {
    return;
  }
  cleanupRan = true;
  if (cleanupState.frameTimer !== undefined) {
    clearInterval(cleanupState.frameTimer);
  }
  if (cleanupState.encoder !== undefined && !progress.ffmpegExited) {
    cleanupState.encoder.kill("SIGKILL");
  }
  if (cleanupState.olos !== undefined) {
    try {
      await cleanupState.olos.stop();
    } catch {
      // best-effort
    }
  }
  if (cleanupState.outDir !== undefined) {
    try {
      await rm(cleanupState.outDir, { force: true, recursive: true });
    } catch {
      // best-effort
    }
  }
}

function installSignalHandlers(decoder: DecoderPool): void {
  const handle = async (signal: NodeJS.Signals): Promise<void> => {
    if (progress.shutdown) {
      return;
    }
    progress.shutdown = true;
    if (!IS_WORKER) {
      console.log(`\n[bench] ${signal} received, draining decoder…`);
    }
    try {
      await decoder.drain();
      const samples = decoder.results() as readonly FinalSample[];
      const sidecarPath = await writeSidecar(samples);
      if (IS_WORKER) {
        emitDone(samples.length, sidecarPath, true);
      } else {
        report(samples, sidecarPath);
      }
    } finally {
      await cleanup();
      // 130 = SIGINT, 143 = SIGTERM — standard exit codes for signal exit.
      process.exit(signal === "SIGINT" ? 130 : 143);
    }
  };

  process.once("SIGINT", () => {
    handle("SIGINT").catch(() => process.exit(130));
  });
  process.once("SIGTERM", () => {
    handle("SIGTERM").catch(() => process.exit(143));
  });
}

async function main(): Promise<void> {
  await ensureCsv();
  const olos = await createLocalOlos({ fps: FPS, port: PORT });
  cleanupState.olos = olos;
  const outDir = await mkdtemp(join(tmpdir(), "olos-benchmark-"));
  cleanupState.outDir = outDir;
  const encoder = spawnEncoder({
    crf: CRF,
    fps: FPS,
    outDir,
    segmentSeconds: FRAGMENT_SECONDS,
  });
  cleanupState.encoder = encoder;
  encoder.once("exit", () => {
    progress.ffmpegExited = true;
  });

  await olos.createSession();

  const frameTimer = setInterval(
    () => {
      encoder.stdin?.write(Buffer.from(encodeFrame(Date.now())));
    },
    Math.round(1000 / FPS)
  );
  cleanupState.frameTimer = frameTimer;

  const decoder = createDecoderPool({
    concurrency: DECODE_CONCURRENCY,
    onResult: (final) => appendCsvRow(final),
  });

  installSignalHandlers(decoder);

  try {
    await Promise.all([runProducer(outDir, olos), runConsumer(olos, decoder)]);
    clearInterval(frameTimer);
    encoder.stdin?.end();

    await decoder.drain();
    stopProgressBar();
    const samples = decoder.results();
    const sidecarPath = await writeSidecar(samples);
    if (IS_WORKER) {
      emitDone(samples.length, sidecarPath, false);
    } else {
      report(samples, sidecarPath);
    }
  } finally {
    await cleanup();
  }
}

await main();
