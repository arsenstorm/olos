// Streams ffmpeg barcode decode alongside the producer/consumer. Each fetched
// fragment is enqueued; up to `concurrency` async ffmpegs decode in parallel.
// On result, the worker drops the bytes, emits a FinalSample to the caller's
// handler (typically: append CSV + push into the results list), and frees the
// slot. drain() resolves when queue + active are both zero.

import { decodeFirstFrameAsync } from "./decoder";

export interface DecoderInput {
  committedAt: number;
  fragmentBytes: Uint8Array;
  initBytes?: Uint8Array;
  msn: number;
  partNumber: number;
  playlistVisibleAt: number;
  renderedAt: number;
  seq: number;
  uploadedAt: number;
}

export interface FinalSample {
  captureAt: number;
  committedAt: number;
  latencyMs: number;
  msn: number;
  partNumber: number;
  playlistVisibleAt: number;
  renderedAt: number;
  seq: number;
  uploadedAt: number;
}

export interface DecoderPool {
  drain: () => Promise<void>;
  enqueue: (sample: DecoderInput) => void;
  results: () => readonly FinalSample[];
}

interface DecodeOptions {
  onIdle: () => void;
  onResult: (final: FinalSample) => Promise<void> | void;
}

interface PoolState {
  active: number;
  drainResolver?: () => void;
  finals: FinalSample[];
  queue: DecoderInput[];
}

export function createDecoderPool(opts: {
  concurrency: number;
  onResult: (final: FinalSample) => Promise<void> | void;
}): DecoderPool {
  const state: PoolState = { active: 0, finals: [], queue: [] };
  const decodeOptions: DecodeOptions = {
    onIdle: () => workerIdle(state),
    onResult: opts.onResult,
  };

  return {
    drain: () => waitForIdle(state),
    enqueue(sample) {
      state.queue.push(sample);
      if (state.active < opts.concurrency) {
        state.active += 1;
        decodeUntilEmpty(state, decodeOptions).catch(() => {
          // decodeUntilEmpty swallows per-sample errors internally; this
          // guards the outer promise so a fire-and-forget start can't reject
          // unhandled.
        });
      }
    },
    results: () => state.finals,
  };
}

function waitForIdle(state: PoolState): Promise<void> {
  return new Promise((resolve) => {
    if (state.active === 0 && state.queue.length === 0) {
      resolve();
      return;
    }
    state.drainResolver = resolve;
  });
}

function workerIdle(state: PoolState): void {
  state.active -= 1;
  if (state.active === 0 && state.queue.length === 0) {
    state.drainResolver?.();
    state.drainResolver = undefined;
  }
}

async function decodeUntilEmpty(
  state: PoolState,
  opts: DecodeOptions
): Promise<void> {
  for (let s = state.queue.shift(); s; s = state.queue.shift()) {
    await decodeSampleQuietly(s, state.finals, opts);
  }
  opts.onIdle();
}

// One sample's decode failure shouldn't take down the run.
async function decodeSampleQuietly(
  sample: DecoderInput,
  finals: FinalSample[],
  opts: DecodeOptions
): Promise<void> {
  try {
    await decodeSample(sample, finals, opts);
  } catch {
    // swallowed: see above
  }
}

async function decodeSample(
  sample: DecoderInput,
  finals: FinalSample[],
  opts: DecodeOptions
): Promise<void> {
  const mp4 =
    sample.initBytes === undefined
      ? sample.fragmentBytes
      : concat(sample.initBytes, sample.fragmentBytes);
  const captureAt = await decodeFirstFrameAsync(mp4);
  if (!Number.isFinite(captureAt)) {
    return;
  }
  const final = toFinalSample(sample, captureAt);
  finals.push(final);
  await opts.onResult(final);
}

function toFinalSample(sample: DecoderInput, captureAt: number): FinalSample {
  return {
    captureAt,
    committedAt: sample.committedAt,
    latencyMs: sample.renderedAt - captureAt,
    msn: sample.msn,
    partNumber: sample.partNumber,
    playlistVisibleAt: sample.playlistVisibleAt,
    renderedAt: sample.renderedAt,
    seq: sample.seq,
    uploadedAt: sample.uploadedAt,
  };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
