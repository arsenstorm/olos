import { mkdtemp, readdir, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { spawnFfmpeg } from "./ffmpeg";
import { createOlosClient } from "./olos-client";

const PART_SECONDS = 0.5;
const PARTS_PER_SEGMENT = 4;
const SEGMENT_SECONDS = PART_SECONDS * PARTS_PER_SEGMENT; // 2.0
const POLL_INTERVAL_MS = 100;
const PART_FILE = /^part-(\d+)\.m4s$/;
const INIT_FILE = "init.mp4";

const RTMP_PORT = Number(process.env.RTMP_PORT ?? 1935);
const BASE_URL = process.env.BASE_URL ?? "http://localhost:8787";
const INGEST_KEY = process.env.INGEST_KEY ?? "dev-key";
const MEDIA_ORIGIN = process.env.MEDIA_ORIGIN ?? "https://localhost:8787";
const SESSION_ID = process.env.SESSION_ID ?? `obs_${Date.now()}`;
const RENDITION_ID = "v1080";

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
    renditionId: RENDITION_ID,
    sessionId: SESSION_ID,
  });

  const outDir = await mkdtemp(join(tmpdir(), "olos-streamer-"));
  console.log(`session ${SESSION_ID}`);
  console.log(`work dir ${outDir}`);
  console.log(`OBS → rtmp://localhost:${RTMP_PORT}/live (any stream key)`);
  console.log("OBS keyframe interval must be 0.5s for LL-HLS parts");

  await olos.createSession({
    partTarget: PART_SECONDS,
    segmentTarget: SEGMENT_SECONDS,
  });

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

  const state: DrainState = {
    initPublished: false,
    nextPartIndex: 0,
    segmentBytesPublished: 0,
  };

  const drain = async (): Promise<void> => {
    let files: string[];
    try {
      files = await readdir(outDir);
    } catch {
      return;
    }

    const availableParts = collectAvailableParts(files);

    if (!state.initPublished) {
      const ready = await publishInitIfReady(
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
  };

  while (!ffmpegExited) {
    await drain();
    await wait(POLL_INTERVAL_MS);
  }
  await drain();

  console.log("ending session");
  try {
    await olos.endSession();
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

interface AvailablePart {
  file: string;
  index: number;
}

interface DrainState {
  initPublished: boolean;
  nextPartIndex: number;
  // Running byte total for the in-progress segment, used to compute the
  // byterange.offset of the next part being published.
  segmentBytesPublished: number;
}

async function publishInitIfReady(
  olos: ReturnType<typeof createOlosClient>,
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
  await olos.publishInit({
    bytes,
    duration: 1,
    mediaSequenceNumber: 0,
  });
  console.log(`published init (${bytes.length}B)`);
  return true;
}

async function publishPendingParts(
  olos: ReturnType<typeof createOlosClient>,
  outDir: string,
  availableParts: readonly AvailablePart[],
  state: DrainState
): Promise<void> {
  for (const { index, file } of availableParts) {
    if (index < state.nextPartIndex) {
      continue;
    }
    if (index !== state.nextPartIndex) {
      // A gap. Wait for the missing part to land rather than skipping
      // ahead and confusing OLOS's part ordering.
      break;
    }

    const bytes = await readFile(join(outDir, file));
    if (bytes.length === 0) {
      break;
    }

    const mediaSequenceNumber = Math.floor(index / PARTS_PER_SEGMENT);
    const partNumber = index % PARTS_PER_SEGMENT;

    // /v/ prefix lands on the Worker's byterange virtual-segment route.
    const segmentPath = `live/${SESSION_ID}/${RENDITION_ID}/${mediaSequenceNumber}.m4s`;
    await olos.publishPart({
      byterange: {
        length: bytes.length,
        offset: state.segmentBytesPublished,
        segmentDeliveryUrl: `${MEDIA_ORIGIN}/v/${SESSION_ID}/${RENDITION_ID}/${mediaSequenceNumber}.m4s`,
        segmentObjectKey: segmentPath,
      },
      bytes,
      duration: PART_SECONDS,
      // OBS keyframe interval = 0.5s → every micro-segment is keyframe-aligned.
      independent: true,
      mediaSequenceNumber,
      partNumber,
    });
    state.segmentBytesPublished += bytes.length;
    console.log(
      `part msn=${mediaSequenceNumber} part=${partNumber} (${bytes.length}B, offset=${state.segmentBytesPublished - bytes.length})`
    );
    state.nextPartIndex = index + 1;

    if (partNumber === PARTS_PER_SEGMENT - 1) {
      const segmentBytes = await assembleSegment(outDir, mediaSequenceNumber);
      await olos.publishSegment({
        bytes: segmentBytes,
        duration: SEGMENT_SECONDS,
        mediaSequenceNumber,
      });
      console.log(
        `segment msn=${mediaSequenceNumber} (${segmentBytes.length}B)`
      );
      await deleteSegmentParts(outDir, mediaSequenceNumber);
      state.segmentBytesPublished = 0;
    }
  }
}

function collectAvailableParts(files: readonly string[]): AvailablePart[] {
  const parts: AvailablePart[] = [];
  for (const file of files) {
    const match = PART_FILE.exec(file);
    if (match) {
      parts.push({ file, index: Number(match[1]) });
    }
  }
  parts.sort((a, b) => a.index - b.index);
  return parts;
}

async function deleteSegmentParts(
  outDir: string,
  mediaSequenceNumber: number
): Promise<void> {
  const firstIndex = mediaSequenceNumber * PARTS_PER_SEGMENT;
  for (let part = 0; part < PARTS_PER_SEGMENT; part += 1) {
    const file = `part-${String(firstIndex + part).padStart(5, "0")}.m4s`;
    try {
      await unlink(join(outDir, file));
    } catch {
      // Already gone — fine, ffmpeg might never have written it on shutdown.
    }
  }
}

async function assembleSegment(
  outDir: string,
  mediaSequenceNumber: number
): Promise<Uint8Array> {
  const firstIndex = mediaSequenceNumber * PARTS_PER_SEGMENT;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (let part = 0; part < PARTS_PER_SEGMENT; part += 1) {
    const file = `part-${String(firstIndex + part).padStart(5, "0")}.m4s`;
    const bytes = await readFile(join(outDir, file));
    chunks.push(bytes);
    length += bytes.length;
  }
  const segment = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    segment.set(chunk, offset);
    offset += chunk.length;
  }
  return segment;
}
