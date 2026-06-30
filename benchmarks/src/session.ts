// Producer/consumer pair for one bench session.
// - Producer: tails the ffmpeg out dir, publishes each new fragment as a part
//   (or whole segment), records publish timestamps keyed by (msn, partNumber).
// - Consumer: chases _HLS_msn[&_HLS_part] blocking-reload, fetches the
//   fragment bytes, stamps playlistVisibleAt + renderedAt, joins them with
//   the producer's publish timestamps, enqueues a DecoderInput.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FRAGMENT_SECONDS,
  INIT_FILE,
  now,
  PART_FILE,
  PARTS_PER_SEGMENT,
  POLL_MS,
  sleep,
  TARGET_SAMPLES,
  usingParts,
} from "./config";
import type { DecoderPool } from "./decoder-pool";
import type { LocalOlos, PublishTimestamps } from "./local-olos";
import { fetchBytes, fragmentKey, parsePlaylist } from "./playlist";
import { emitProgress } from "./telemetry";

export interface Progress {
  ffmpegExited: boolean;
  initPublished: boolean;
  nextFragment: number;
  publishTimings: Map<string, PublishTimestamps>;
  shutdown: boolean;
  targetReached: boolean;
}

export const progress: Progress = {
  ffmpegExited: false,
  initPublished: false,
  nextFragment: 0,
  publishTimings: new Map(),
  shutdown: false,
  targetReached: false,
};

export async function runProducer(
  outDir: string,
  olos: LocalOlos
): Promise<void> {
  while (
    !(progress.shutdown || progress.ffmpegExited || progress.targetReached)
  ) {
    await drain(outDir, olos);
    await sleep(POLL_MS);
  }
  if (!progress.shutdown) {
    await drain(outDir, olos);
  }
}

// Publishes the init segment once both INIT_FILE and a first part exist.
// Returns true when init is ready (already published or just published now),
// false when the producer should wait for more files.
async function ensureInit(
  outDir: string,
  olos: LocalOlos,
  files: string[]
): Promise<boolean> {
  if (progress.initPublished) {
    return true;
  }
  const hasPart = files.some((file) => PART_FILE.test(file));
  if (!(files.includes(INIT_FILE) && hasPart)) {
    return false;
  }
  const initBytes = await readFile(join(outDir, INIT_FILE));
  if (initBytes.length === 0) {
    return false;
  }
  await olos.publishInit(initBytes);
  progress.initPublished = true;
  return true;
}

async function drain(outDir: string, olos: LocalOlos): Promise<void> {
  let files: string[];
  try {
    files = await readdir(outDir);
  } catch {
    return;
  }

  if (!(await ensureInit(outDir, olos, files))) {
    return;
  }

  const fragments = files
    .map((file) => PART_FILE.exec(file))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);

  for (const index of fragments) {
    if (progress.targetReached || progress.shutdown) {
      return;
    }
    if (index !== progress.nextFragment) {
      continue;
    }
    const bytes = await readFile(
      join(outDir, `part-${String(index).padStart(5, "0")}.m4s`)
    );
    if (bytes.length === 0) {
      return;
    }
    const msn = usingParts ? Math.floor(index / PARTS_PER_SEGMENT) : index;
    const partNumber = usingParts ? index % PARTS_PER_SEGMENT : 0;
    const timestamps = usingParts
      ? await olos.publishPart({
          bytes,
          mediaSequenceNumber: msn,
          partNumber,
          partSeconds: FRAGMENT_SECONDS,
        })
      : await olos.publishSegment({
          bytes,
          mediaSequenceNumber: msn,
          segmentSeconds: FRAGMENT_SECONDS,
        });
    progress.publishTimings.set(fragmentKey(msn, partNumber), timestamps);
    progress.nextFragment = index + 1;
  }
}

export async function runConsumer(
  olos: LocalOlos,
  decoder: DecoderPool
): Promise<void> {
  const startFragment = PARTS_PER_SEGMENT;
  let initBytes: Uint8Array | undefined;
  let nextFragment = startFragment;
  let emitted = 0;

  while (
    !progress.shutdown &&
    emitted < TARGET_SAMPLES &&
    !(progress.ffmpegExited && nextFragment >= progress.nextFragment)
  ) {
    const msn = Math.floor(nextFragment / PARTS_PER_SEGMENT);
    const partNumber = nextFragment % PARTS_PER_SEGMENT;
    const partQuery = usingParts ? `&_HLS_part=${partNumber}` : "";
    const url = `https://edge.example.com/v1/live/${olos.sessionId}/${olos.renditionId}/media.m3u8?_HLS_msn=${msn}${partQuery}`;
    const response = await olos.handle(new Request(url));
    const playlistVisibleAt = now();
    if (response.status !== 200) {
      await sleep(POLL_MS);
      continue;
    }
    const playlist = parsePlaylist(await response.text());
    const uri = usingParts
      ? playlist.partUris.get(fragmentKey(msn, partNumber))
      : playlist.segmentUris[msn - playlist.mediaSequence];
    if (uri === undefined) {
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
    const renderedAt = now();

    const publish = progress.publishTimings.get(fragmentKey(msn, partNumber));
    if (publish === undefined) {
      nextFragment += 1;
      continue;
    }
    progress.publishTimings.delete(fragmentKey(msn, partNumber));

    const input = {
      committedAt: publish.committedAt,
      fragmentBytes,
      initBytes,
      msn,
      partNumber,
      playlistVisibleAt,
      renderedAt,
      seq: emitted,
      uploadedAt: publish.uploadedAt,
    };
    decoder.enqueue(input);
    emitProgress(input);
    emitted += 1;
    nextFragment += 1;
  }

  progress.targetReached = true;
}
