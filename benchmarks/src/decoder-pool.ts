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
  drain(): Promise<void>;
  enqueue(sample: DecoderInput): void;
  results(): readonly FinalSample[];
}

export function createDecoderPool(opts: {
  concurrency: number;
  onResult(final: FinalSample): Promise<void> | void;
}): DecoderPool {
  const queue: DecoderInput[] = [];
  const finals: FinalSample[] = [];
  let active = 0;
  let drainResolver: (() => void) | undefined;

  const runWorker = async (): Promise<void> => {
    while (true) {
      const sample = queue.shift();
      if (sample === undefined) {
        active -= 1;
        if (active === 0 && queue.length === 0 && drainResolver !== undefined) {
          drainResolver();
          drainResolver = undefined;
        }
        return;
      }
      try {
        const mp4 =
          sample.initBytes === undefined
            ? sample.fragmentBytes
            : concat(sample.initBytes, sample.fragmentBytes);
        const captureAt = await decodeFirstFrameAsync(mp4);
        if (Number.isFinite(captureAt)) {
          const final: FinalSample = {
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
          finals.push(final);
          await opts.onResult(final);
        }
      } catch {
        // One sample's decode failure shouldn't take down the run.
      }
    }
  };

  return {
    drain() {
      return new Promise((resolve) => {
        if (active === 0 && queue.length === 0) {
          resolve();
          return;
        }
        drainResolver = resolve;
      });
    },
    enqueue(sample) {
      queue.push(sample);
      if (active < opts.concurrency) {
        active += 1;
        runWorker().catch(() => {
          // runWorker swallows per-sample errors internally; this guards the
          // outer promise so a fire-and-forget start can't reject unhandled.
        });
      }
    },
    results() {
      return finals;
    },
  };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
