// OLOS end-to-end benchmark — 30 fps of real H.264 for 30 s.
//
// Streams a real encoded stream through the real OLOS publish + manifest path
// and reads it back out, measuring how long each part (or segment, in the
// fallback mode) takes from capture to fetchable. Fully local and free — see
// ./README.md for what it measures, what it excludes, and the local-only
// guarantee.
//
//   ffmpeg ──raw barcode frames──▶ fMP4 parts ──▶ OLOS publish
//                                                     │
//   latency = fetched − captured ◀── decode barcode ◀── consumer chases manifest
//
// Run: bun run benchmark.

// Loopback bench only — accept the self-signed media-origin cert without
// wiring a trust store. Set BEFORE importing the harness so the harness
// itself stays side-effect-free for any other importer.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFrame } from "./barcode";
import {
  createLocalOlos,
  decodeFirstFrame,
  type LocalOlos,
  spawnEncoder,
} from "./harness";

const FPS = Number(process.env.OLOS_BENCH_FPS ?? 30);
const DURATION_SECONDS = Number(process.env.OLOS_BENCH_DURATION_S ?? 30);
const SEGMENT_MS = Number(process.env.OLOS_BENCH_SEGMENT_MS ?? 500);
const SEGMENT_SECONDS = SEGMENT_MS / 1000;
// OLOS_BENCH_PART_MS=0 falls back to segments-only mode (one publish per
// segment cadence). Otherwise the encoder emits fragments at PART_MS cadence
// and the producer publishes each as an LL-HLS part. The bench publishes
// parts only — no segment commits — so retention keeps the live window
// bounded purely by `maxSegments` over part-only MSNs.
// Default 100 ms picks a value where `PART_MS * FPS / 1000` is an integer
// at the default 30 fps (3 frames/part) — non-integer frames-per-part lets
// the muxer cut between keyframes and breaks first-frame decode.
const PART_MS = Number(process.env.OLOS_BENCH_PART_MS ?? 100);
const CRF = Number(process.env.OLOS_BENCH_CRF ?? 18);
const PORT = Number(process.env.OLOS_BENCH_PORT ?? 8799);

const usingParts = PART_MS > 0 && PART_MS < SEGMENT_MS;
if (usingParts && SEGMENT_MS % PART_MS !== 0) {
  throw new Error(
    `OLOS_BENCH_SEGMENT_MS (${SEGMENT_MS}) must be a multiple of OLOS_BENCH_PART_MS (${PART_MS})`
  );
}
const PARTS_PER_SEGMENT = usingParts ? Math.round(SEGMENT_MS / PART_MS) : 1;
const FRAGMENT_SECONDS = usingParts ? PART_MS / 1000 : SEGMENT_SECONDS;

const POLL_MS = 25;
const INIT_FILE = "init.mp4";
const PART_FILE = /^part-(\d+)\.m4s$/;
const MEDIA_SEQUENCE = /#EXT-X-MEDIA-SEQUENCE:(\d+)/;
const MAP_URI = /#EXT-X-MAP:URI="([^"]+)"/;
const EXT_X_PART_URI = /^#EXT-X-PART:.*URI="([^"]+)"/;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Shared progress between the producer and the consumer. `nextFragment` is
// the next ffmpeg output file index to publish (= MSN in segments-only mode,
// = MSN * PARTS_PER_SEGMENT + partNumber in parts mode).
const progress = { ffmpegExited: false, initPublished: false, nextFragment: 0 };

// --- producer: publish encoded fragments as ffmpeg writes them -----------

async function runProducer(outDir: string, olos: LocalOlos): Promise<void> {
  while (!progress.ffmpegExited) {
    await drain(outDir, olos);
    await sleep(POLL_MS);
  }
  await drain(outDir, olos);
}

async function drain(outDir: string, olos: LocalOlos): Promise<void> {
  let files: string[];
  try {
    files = await readdir(outDir);
  } catch {
    return;
  }

  if (!progress.initPublished) {
    const hasPart = files.some((file) => PART_FILE.test(file));
    if (!(files.includes(INIT_FILE) && hasPart)) {
      return;
    }
    const initBytes = await readFile(join(outDir, INIT_FILE));
    if (initBytes.length === 0) {
      return;
    }
    await olos.publishInit(initBytes);
    progress.initPublished = true;
  }

  const fragments = files
    .map((file) => PART_FILE.exec(file))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);

  for (const index of fragments) {
    if (index !== progress.nextFragment) {
      continue;
    }
    const bytes = await readFile(
      join(outDir, `part-${String(index).padStart(5, "0")}.m4s`)
    );
    if (bytes.length === 0) {
      return;
    }
    if (usingParts) {
      await olos.publishPart({
        bytes,
        mediaSequenceNumber: Math.floor(index / PARTS_PER_SEGMENT),
        partNumber: index % PARTS_PER_SEGMENT,
        partSeconds: FRAGMENT_SECONDS,
      });
    } else {
      await olos.publishSegment({
        bytes,
        mediaSequenceNumber: index,
        segmentSeconds: FRAGMENT_SECONDS,
      });
    }
    progress.nextFragment = index + 1;
  }
}

// --- consumer: chase the manifest, record fetch time + bytes -------------
// Decoding is deferred to a post-run pass so a blocking ffmpeg decode never
// stalls the live loop and distorts the latency we are measuring.

interface Sample {
  fragmentBytes: Uint8Array;
  visibleAt: number;
}

async function runConsumer(
  olos: LocalOlos
): Promise<{ initBytes?: Uint8Array; samples: Sample[] }> {
  // Skip the first segment as warm-up: init lands after the first part exists,
  // so MSN 0 races init publish and would distort the warm-up sample.
  const startFragment = PARTS_PER_SEGMENT;
  const samples: Sample[] = [];
  let initBytes: Uint8Array | undefined;
  let nextFragment = startFragment;

  while (!(progress.ffmpegExited && nextFragment >= progress.nextFragment)) {
    const msn = Math.floor(nextFragment / PARTS_PER_SEGMENT);
    const partNumber = nextFragment % PARTS_PER_SEGMENT;
    const partQuery = usingParts ? `&_HLS_part=${partNumber}` : "";
    const url = `https://edge.example.com/v1/live/${olos.sessionId}/${olos.renditionId}/media.m3u8?_HLS_msn=${msn}${partQuery}`;
    const response = await olos.handle(new Request(url));
    if (response.status !== 200) {
      await sleep(POLL_MS);
      continue;
    }
    const playlist = parsePlaylist(await response.text());
    const uri = usingParts
      ? playlist.partUris.get(fragmentKey(msn, partNumber))
      : playlist.segmentUris[msn - playlist.mediaSequence];
    if (uri === undefined) {
      // Manifest doesn't yet cover what we asked for — fell behind the live
      // window or the wake hasn't landed. Re-poll.
      if (msn < playlist.mediaSequence) {
        nextFragment = playlist.mediaSequence * PARTS_PER_SEGMENT;
        continue;
      }
      await sleep(POLL_MS);
      continue;
    }
    if (initBytes === undefined && playlist.initUri !== undefined) {
      initBytes = await fetchBytes(playlist.initUri);
    }
    const fragmentBytes = await fetchBytes(uri);
    samples.push({ fragmentBytes, visibleAt: Date.now() });
    nextFragment += 1;
  }

  return { initBytes, samples };
}

interface ParsedPlaylist {
  initUri?: string;
  mediaSequence: number;
  partUris: Map<string, string>;
  segmentUris: string[];
}

function fragmentKey(msn: number, partNumber: number): string {
  return `${msn}/${partNumber}`;
}

function parsePlaylist(body: string): ParsedPlaylist {
  const mediaSequence = Number(MEDIA_SEQUENCE.exec(body)?.[1] ?? 0);
  const initUri = MAP_URI.exec(body)?.[1];
  const segmentUris: string[] = [];
  const partUris = new Map<string, string>();
  let partIndex = 0;

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("https://")) {
      segmentUris.push(line);
      continue;
    }
    const partMatch = EXT_X_PART_URI.exec(line);
    if (partMatch?.[1] !== undefined) {
      const msn = mediaSequence + Math.floor(partIndex / PARTS_PER_SEGMENT);
      const partNumber = partIndex % PARTS_PER_SEGMENT;
      partUris.set(fragmentKey(msn, partNumber), partMatch[1]);
      partIndex += 1;
    }
  }

  return { initUri, mediaSequence, partUris, segmentUris };
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch ${url} → ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

// --- measurement ---------------------------------------------------------

function decodeLatencies(
  initBytes: Uint8Array | undefined,
  samples: Sample[]
): number[] {
  return samples.map((sample) => {
    const mp4 =
      initBytes === undefined
        ? sample.fragmentBytes
        : concat(initBytes, sample.fragmentBytes);
    const captureMs = decodeFirstFrame(mp4);
    if (!Number.isFinite(captureMs)) {
      throw new Error("barcode unreadable in a streamed fragment");
    }
    return sample.visibleAt - captureMs;
  });
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function percentile(sorted: number[], fraction: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.floor(fraction * sorted.length)
  );
  return sorted[index] as number;
}

function report(latencies: number[]): void {
  if (latencies.length === 0) {
    throw new Error("no fragments measured");
  }
  if (latencies.some((value) => value < 0)) {
    throw new Error("measured a negative latency");
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const fmt = (ms: number) => `${ms.toFixed(0)} ms`;
  const fragmentMs = FRAGMENT_SECONDS * 1000;
  const p50 = percentile(sorted, 0.5);
  // The fragment can't be published until its last frame is encoded, so
  // measuring from its first frame inherently includes one fragment of fill.
  // Subtract it to expose the OLOS-owned slice (encode tail + slot/grant +
  // commit + manifest render + wake).
  const overheadMs = Math.max(0, p50 - fragmentMs);
  const mode = usingParts
    ? `parts (${PARTS_PER_SEGMENT}/segment)`
    : "segments only";

  console.log("\nOLOS end-to-end benchmark (real H.264 over OLOS, local-only)");
  console.log(`  source            : ${FPS} fps for ${DURATION_SECONDS} s`);
  console.log(`  mode              : ${mode}`);
  console.log(`  fragment duration : ${fragmentMs.toFixed(0)} ms`);
  console.log(`  fragments measured: ${sorted.length}`);
  console.log(`  p50               : ${fmt(p50)}`);
  console.log(`  p95               : ${fmt(percentile(sorted, 0.95))}`);
  console.log(`  p99               : ${fmt(percentile(sorted, 0.99))}`);
  console.log(`  max               : ${fmt(sorted.at(-1) as number)}`);
  console.log(`  mean              : ${fmt(mean)}`);
  console.log(`  olos overhead p50 : ~${fmt(overheadMs)}  (p50 − fragment ms)`);
  console.log(
    "\nEncode → publish → manifest → fetch. A real player adds its own"
  );
  console.log("buffering on top for the full end-to-end figure.\n");
}

// --- main ----------------------------------------------------------------

async function main(): Promise<void> {
  const olos = await createLocalOlos({ fps: FPS, port: PORT });
  const outDir = await mkdtemp(join(tmpdir(), "olos-benchmark-"));
  const encoder = spawnEncoder({
    crf: CRF,
    fps: FPS,
    outDir,
    segmentSeconds: FRAGMENT_SECONDS,
  });
  encoder.once("exit", () => {
    progress.ffmpegExited = true;
  });

  await olos.createSession();

  // Feed barcode frames at real cadence; each frame's barcode is its capture time.
  const frameTimer = setInterval(
    () => {
      encoder.stdin?.write(Buffer.from(encodeFrame(Date.now())));
    },
    Math.round(1000 / FPS)
  );
  const stopTimer = setTimeout(() => {
    clearInterval(frameTimer);
    encoder.stdin?.end();
  }, DURATION_SECONDS * 1000);

  try {
    const [, consumed] = await Promise.all([
      runProducer(outDir, olos),
      runConsumer(olos),
    ]);
    report(decodeLatencies(consumed.initBytes, consumed.samples));
  } finally {
    clearInterval(frameTimer);
    clearTimeout(stopTimer);
    if (!progress.ffmpegExited) {
      encoder.kill("SIGKILL");
    }
    await olos.stop();
    await rm(outDir, { force: true, recursive: true });
  }
}

await main();
