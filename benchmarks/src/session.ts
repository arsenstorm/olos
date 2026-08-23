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
import type { DecoderInput, DecoderPool } from "./decoder-pool";
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

  for (const index of listFragmentIndexes(files)) {
    if (progress.targetReached || progress.shutdown) {
      return;
    }
    if (index !== progress.nextFragment) {
      continue;
    }
    const published = await publishFragment(olos, outDir, index);
    if (!published) {
      return;
    }
  }
}

function listFragmentIndexes(files: readonly string[]): number[] {
  return files
    .map((file) => PART_FILE.exec(file))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
}

// Returns false when the file is still empty (ffmpeg has not flushed it yet).
async function publishFragment(
  olos: LocalOlos,
  outDir: string,
  index: number
): Promise<boolean> {
  const bytes = await readFile(
    join(outDir, `part-${String(index).padStart(5, "0")}.m4s`)
  );
  if (bytes.length === 0) {
    return false;
  }
  const msn = usingParts ? Math.floor(index / PARTS_PER_SEGMENT) : index;
  const partNumber = usingParts ? index % PARTS_PER_SEGMENT : 0;
  const timestamps = usingParts
    ? await olos.publishPart({
        bytes,
        partNumber,
        partSeconds: FRAGMENT_SECONDS,
        sequenceNumber: msn,
      })
    : await olos.publishSegment({
        bytes,
        segmentSeconds: FRAGMENT_SECONDS,
        sequenceNumber: msn,
      });
  progress.publishTimings.set(fragmentKey(msn, partNumber), timestamps);
  progress.nextFragment = index + 1;
  return true;
}

interface ConsumerCursor {
  emitted: number;
  initBytes?: Uint8Array;
  nextFragment: number;
}

export async function runConsumer(
  olos: LocalOlos,
  decoder: DecoderPool
): Promise<void> {
  const cursor: ConsumerCursor = {
    emitted: 0,
    nextFragment: PARTS_PER_SEGMENT,
  };

  while (consumerShouldContinue(cursor)) {
    await consumeNextFragment(olos, decoder, cursor);
  }

  progress.targetReached = true;
}

function consumerShouldContinue(cursor: ConsumerCursor): boolean {
  if (progress.shutdown || cursor.emitted >= TARGET_SAMPLES) {
    return false;
  }
  const producerDrained =
    progress.ffmpegExited && cursor.nextFragment >= progress.nextFragment;
  return !producerDrained;
}

// One blocking-reload round trip: advances `cursor.nextFragment` when the
// fragment was fetched (or is behind the live window), otherwise sleeps.
async function consumeNextFragment(
  olos: LocalOlos,
  decoder: DecoderPool,
  cursor: ConsumerCursor
): Promise<void> {
  const msn = Math.floor(cursor.nextFragment / PARTS_PER_SEGMENT);
  const partNumber = cursor.nextFragment % PARTS_PER_SEGMENT;
  const partQuery = usingParts ? `&_HLS_part=${partNumber}` : "";
  const url = `https://edge.example.com/v1/live/${olos.sessionId}/${olos.trackId}/media.m3u8?_HLS_msn=${msn}${partQuery}`;
  const response = await olos.handle(new Request(url));
  const playlistVisibleAt = now();
  if (response.status !== 200) {
    await sleep(POLL_MS);
    return;
  }
  const playlist = parsePlaylist(await response.text());
  const uri = resolveFragmentUri(playlist, msn, partNumber);
  if (uri === undefined) {
    if (msn < playlist.mediaSequence) {
      cursor.nextFragment = playlist.mediaSequence * PARTS_PER_SEGMENT;
      return;
    }
    await sleep(POLL_MS);
    return;
  }
  if (cursor.initBytes === undefined && playlist.initUri !== undefined) {
    cursor.initBytes = await fetchBytes(playlist.initUri);
  }
  await recordFragment(decoder, cursor, {
    msn,
    partNumber,
    playlistVisibleAt,
    uri,
  });
}

// Fetches the fragment, joins it with the producer's publish timestamps, and
// hands the sample to the decoder. Fragments the producer never stamped
// (published before the consumer started) are skipped.
async function recordFragment(
  decoder: DecoderPool,
  cursor: ConsumerCursor,
  fragment: {
    msn: number;
    partNumber: number;
    playlistVisibleAt: number;
    uri: string;
  }
): Promise<void> {
  const { msn, partNumber, playlistVisibleAt } = fragment;
  const fragmentBytes = await fetchBytes(fragment.uri);
  const renderedAt = now();

  const publish = progress.publishTimings.get(fragmentKey(msn, partNumber));
  if (publish === undefined) {
    cursor.nextFragment += 1;
    return;
  }
  progress.publishTimings.delete(fragmentKey(msn, partNumber));

  const input = buildDecoderInput({
    cursor,
    fragmentBytes,
    msn,
    partNumber,
    playlistVisibleAt,
    publish,
    renderedAt,
  });
  decoder.enqueue(input);
  emitProgress(input);
  cursor.emitted += 1;
  cursor.nextFragment += 1;
}

function resolveFragmentUri(
  playlist: ReturnType<typeof parsePlaylist>,
  msn: number,
  partNumber: number
): string | undefined {
  return usingParts
    ? playlist.partUris.get(fragmentKey(msn, partNumber))
    : playlist.segmentUris[msn - playlist.mediaSequence];
}

function buildDecoderInput(fields: {
  cursor: ConsumerCursor;
  fragmentBytes: Uint8Array;
  msn: number;
  partNumber: number;
  playlistVisibleAt: number;
  publish: PublishTimestamps;
  renderedAt: number;
}): DecoderInput {
  return {
    committedAt: fields.publish.committedAt,
    fragmentBytes: fields.fragmentBytes,
    initBytes: fields.cursor.initBytes,
    msn: fields.msn,
    partNumber: fields.partNumber,
    playlistVisibleAt: fields.playlistVisibleAt,
    renderedAt: fields.renderedAt,
    seq: fields.cursor.emitted,
    uploadedAt: fields.publish.uploadedAt,
  };
}
