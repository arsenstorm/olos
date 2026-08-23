import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { spawnFfmpeg } from "./ffmpeg";
import { parseInitCodecs } from "./init-codecs";
import { createOlosClient, type OlosClient } from "./olos-client";
import {
  type AvailablePart,
  assembleSegment,
  collectAvailableParts,
  collectNextSegmentBatch,
  deleteSegmentParts,
  PARTS_PER_SEGMENT,
  type SegmentBatch,
} from "./parts";

const PART_SECONDS = 0.5;
const SEGMENT_SECONDS = PART_SECONDS * PARTS_PER_SEGMENT; // 2.0
const POLL_INTERVAL_MS = 100;
const INIT_FILE = "init.mp4";

const RTMP_PORT = Number(process.env.RTMP_PORT ?? 1935);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:8787";
const INGEST_KEY = process.env.INGEST_KEY ?? "dev-key";
const MEDIA_ORIGIN = process.env.MEDIA_ORIGIN ?? "https://localhost:8787";
const SESSION_ID = process.env.SESSION_ID ?? `obs_${Date.now()}`;
const TRACK_ID = "v1080";
// Declared BANDWIDTH. Must be >= the encoder's peak output or the player
// reports "Segment exceeds specified bandwidth for variant". Match this to
// the OBS video bitrate (plus audio headroom).
const VIDEO_BITRATE = Number(process.env.VIDEO_BITRATE ?? 12_000_000);

try {
  await main();
} catch (error) {
  const olosBody = (error as { body?: unknown }).body;
  if (olosBody !== undefined) {
    console.error("[streamer] OLOS error:", JSON.stringify(olosBody, null, 2));
  }
  throw error;
}

async function main(): Promise<void> {
  const olos = createOlosClient({
    baseUrl: BASE_URL,
    ingestKey: INGEST_KEY,
    mediaOrigin: MEDIA_ORIGIN,
    sessionId: SESSION_ID,
    trackId: TRACK_ID,
  });

  const outDir = await mkdtemp(join(tmpdir(), "olos-streamer-"));
  console.log(`session ${SESSION_ID}`);
  console.log(`work dir ${outDir}`);
  console.log(`OBS → rtmp://localhost:${RTMP_PORT}/live (any stream key)`);
  console.log("OBS keyframe interval must be 0.5s for LL-HLS parts");

  const ffmpeg = startFfmpeg(outDir);
  const state: DrainState = {
    initPublished: false,
    nextPartIndex: 0,
    segmentBytesPublished: 0,
  };

  while (!ffmpeg.exited()) {
    // biome-ignore lint/performance/noAwaitInLoops: each poll must drain fully before the next wait, or parts would be read out of order.
    await drain(olos, outDir, state);
    await wait(POLL_INTERVAL_MS);
  }
  await drain(olos, outDir, state);

  console.log("ending session");
  try {
    await olos.endSession();
  } finally {
    await rm(outDir, { force: true, recursive: true });
  }
}

interface RunningFfmpeg {
  exited: () => boolean;
}

// The session is created from the init segment, not before it: the
// track's CODECS must describe the bitstream OBS actually sent.
// Safari's native HLS player builds its decoders from CODECS and drops
// any track whose declaration does not match, so a guessed profile plays
// as audio-only (or not at all) even though hls.js probes past it.
function startFfmpeg(outDir: string): RunningFfmpeg {
  const ffmpeg = spawnFfmpeg({
    outDir,
    partSeconds: PART_SECONDS,
    port: RTMP_PORT,
  });

  let ffmpegExited = false;
  ffmpeg.once("exit", (code) => {
    ffmpegExited = true;
    console.log(`ffmpeg exited (${code ?? "signal"})`);
  });

  const onSignal = () => ffmpeg.kill("SIGINT");
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  return { exited: () => ffmpegExited };
}

async function drain(
  olos: OlosClient,
  outDir: string,
  state: DrainState
): Promise<void> {
  let files: string[];
  try {
    files = await readdir(outDir);
  } catch {
    return;
  }

  const availableParts = collectAvailableParts(files);

  if (!state.initPublished) {
    const ready = await createSessionAndPublishInit(
      olos,
      outDir,
      files,
      availableParts
    );
    if (!ready) {
      return;
    }
    state.initPublished = true;
  }

  await publishPendingParts(olos, outDir, availableParts, state);
}

interface DrainState {
  initPublished: boolean;
  nextPartIndex: number;
  // Running byte total for the in-progress segment, used to compute the
  // byterange.offset of the next part being published.
  segmentBytesPublished: number;
}

async function createSessionAndPublishInit(
  olos: OlosClient,
  outDir: string,
  files: readonly string[],
  availableParts: readonly AvailablePart[]
): Promise<boolean> {
  // Wait for the first part to exist before reading init.mp4 — proves
  // ffmpeg has flushed the init segment.
  if (!files.includes(INIT_FILE) || availableParts.length === 0) {
    return false;
  }
  const bytes = await readFile(join(outDir, INIT_FILE));
  if (bytes.length === 0) {
    return false;
  }

  const codecs = parseInitCodecs(bytes);
  console.log(
    `codecs video=${codecs.videoCodec ?? "?"} audio=${codecs.audioCodec ?? "none"} ${codecs.width ?? "?"}x${codecs.height ?? "?"}`
  );
  await olos.createSession({
    audioCodec: codecs.audioCodec,
    bitrate: VIDEO_BITRATE,
    height: codecs.height,
    partTarget: PART_SECONDS,
    segmentTarget: SEGMENT_SECONDS,
    videoCodec: codecs.videoCodec,
    width: codecs.width,
  });

  await olos.publishInit({
    bytes,
    duration: 1,
    sequenceNumber: 0,
  });
  console.log(`published init (${bytes.length}B)`);
  return true;
}

async function publishPendingParts(
  olos: OlosClient,
  outDir: string,
  availableParts: readonly AvailablePart[],
  state: DrainState
): Promise<void> {
  // Drain a segment at a time, publishing all available contiguous parts of
  // that segment in parallel. Server-side createCommittedWindow tolerates
  // out-of-order commits (the cursor waits for the contiguous prefix), so
  // the four part publishes can race safely. At ~400 ms per publish on
  // Workers Free, serial would lose ~250 ms per 2 s segment cycle —
  // parallel collapses the four parts into one ~600 ms wall window.
  for (;;) {
    const batch = collectNextSegmentBatch(availableParts, state.nextPartIndex);
    if (batch === undefined) {
      return;
    }

    // biome-ignore lint/performance/noAwaitInLoops: each batch advances state.nextPartIndex, which the next collectNextSegmentBatch call depends on.
    const published = await publishSegmentBatch(olos, outDir, batch, state);
    if (!published) {
      return;
    }

    await finalizeSegmentIfComplete(olos, outDir, batch, state);
  }
}

interface PartPublish {
  bytes: Uint8Array;
  offset: number;
  partNumber: number;
}

// Returns false when a part file is still being written (empty read), which
// leaves `state` untouched so the next drain retries the same batch.
async function publishSegmentBatch(
  olos: OlosClient,
  outDir: string,
  batch: SegmentBatch,
  state: DrainState
): Promise<boolean> {
  const chunks = await Promise.all(
    batch.parts.map((part) => readFile(join(outDir, part.file)))
  );
  if (chunks.some((bytes) => bytes.length === 0)) {
    return false;
  }

  const publishes = planPartPublishes(
    batch,
    chunks,
    state.segmentBytesPublished
  );

  await publishParts(olos, batch, publishes);
  logPublishedParts(batch, publishes);
  state.segmentBytesPublished = publishes.reduce(
    (end, { bytes, offset }) => Math.max(end, offset + bytes.length),
    state.segmentBytesPublished
  );
  state.nextPartIndex = (batch.parts.at(-1) as AvailablePart).index + 1;
  return true;
}

async function publishParts(
  olos: OlosClient,
  batch: SegmentBatch,
  publishes: readonly PartPublish[]
): Promise<void> {
  // Phase 1: serial grants. Each /s3/slots call mutates coordinator
  // state; running them in parallel races the etag and exhausts the
  // mutation retry budget on Workers Free.
  const grants: Awaited<ReturnType<typeof olos.issueGrant>>[] = [];
  for (const publish of publishes) {
    // biome-ignore lint/performance/noAwaitInLoops: parallel /s3/slots calls race the coordinator's etag and exhaust the mutation retry budget.
    grants.push(await olos.issueGrant(partGrant(batch, publish)));
  }

  // Phase 2: parallel R2 PUTs. No coordinator state — pure I/O.
  const pending = await Promise.all(
    grants.map((grant) => olos.uploadGranted(grant))
  );

  // Phase 3: serial commits. Same state-mutation reason as the grants.
  for (const item of pending) {
    // biome-ignore lint/performance/noAwaitInLoops: parallel commits race the coordinator's etag, same reason as the grants above.
    await olos.commitPublication(item);
  }
}

// Assigns each part its byterange.offset within the in-progress segment,
// continuing from the bytes already published for that segment.
function planPartPublishes(
  batch: SegmentBatch,
  chunks: readonly Uint8Array[],
  startOffset: number
): PartPublish[] {
  let runningOffset = startOffset;
  return batch.parts.map((part, i) => {
    const bytes = chunks[i] as Uint8Array;
    const offset = runningOffset;
    runningOffset += bytes.length;
    return { bytes, offset, partNumber: part.index % PARTS_PER_SEGMENT };
  });
}

function logPublishedParts(
  batch: SegmentBatch,
  publishes: readonly PartPublish[]
): void {
  for (const { bytes, offset, partNumber } of publishes) {
    console.log(
      `part msn=${batch.sequenceNumber} part=${partNumber} (${bytes.length}B, offset=${offset})`
    );
  }
}

function partGrant(
  batch: SegmentBatch,
  { bytes, offset, partNumber }: PartPublish
): Parameters<OlosClient["issueGrant"]>[0] {
  const segmentPath = `${SESSION_ID}/${TRACK_ID}/${batch.sequenceNumber}.m4s`;
  return {
    byterange: {
      length: bytes.length,
      offset,
      segmentDeliveryUrl: `${MEDIA_ORIGIN}/v/${segmentPath}`,
      segmentObjectKey: `live/${segmentPath}`,
    },
    bytes,
    duration: PART_SECONDS,
    // OBS keyframe interval = 0.5s → every micro-segment is keyframe-aligned.
    independent: true,
    partNumber,
    sequenceNumber: batch.sequenceNumber,
  };
}

async function finalizeSegmentIfComplete(
  olos: OlosClient,
  outDir: string,
  batch: SegmentBatch,
  state: DrainState
): Promise<void> {
  const lastPartNumber =
    (batch.parts.at(-1) as AvailablePart).index % PARTS_PER_SEGMENT;
  if (lastPartNumber !== PARTS_PER_SEGMENT - 1) {
    return;
  }

  const segmentBytes = await assembleSegment(outDir, batch.sequenceNumber);
  await olos.publishSegment({
    bytes: segmentBytes,
    duration: SEGMENT_SECONDS,
    sequenceNumber: batch.sequenceNumber,
  });
  console.log(`segment msn=${batch.sequenceNumber} (${segmentBytes.length}B)`);
  await deleteSegmentParts(outDir, batch.sequenceNumber);
  state.segmentBytesPublished = 0;
}
