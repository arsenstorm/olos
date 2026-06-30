// Percentile + per-stage aggregate over a set of samples. Shared by the
// worker's end-of-run report and the orchestrator's cross-worker aggregate.

export interface StagePercentiles {
  encodeFill: { p50: number; p95: number };
  fetch: { p50: number; p95: number };
  publish: { p50: number; p95: number };
  wake: { p50: number; p95: number };
}

export interface AggregateStats {
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  samples: number;
  stagePercentiles: StagePercentiles;
}

export interface AggregateInput {
  captureAt: number;
  committedAt: number;
  latencyMs: number;
  playlistVisibleAt: number;
  renderedAt: number;
  uploadedAt: number;
}

const EMPTY_STAGE = { p50: 0, p95: 0 };
const EMPTY: AggregateStats = {
  mean: 0,
  p50: 0,
  p95: 0,
  p99: 0,
  samples: 0,
  stagePercentiles: {
    encodeFill: EMPTY_STAGE,
    fetch: EMPTY_STAGE,
    publish: EMPTY_STAGE,
    wake: EMPTY_STAGE,
  },
};

export function percentile(sorted: number[], fraction: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.floor(fraction * sorted.length)
  );
  return sorted[index] as number;
}

export function aggregate(samples: readonly AggregateInput[]): AggregateStats {
  if (samples.length === 0) {
    return EMPTY;
  }
  const sortAsc = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
  const latencies = sortAsc(samples.map((s) => s.latencyMs));
  const encodeFill = sortAsc(samples.map((s) => s.uploadedAt - s.captureAt));
  const publish = sortAsc(samples.map((s) => s.committedAt - s.uploadedAt));
  const wake = sortAsc(samples.map((s) => s.playlistVisibleAt - s.committedAt));
  const fetch = sortAsc(samples.map((s) => s.renderedAt - s.playlistVisibleAt));
  // No rounding: the in-process stages are sub-millisecond, so integer-ms
  // rounding here is what collapsed `wake`/`fetch` to 0. Callers format for
  // display. (Total/encodeFill still carry the barcode's ms-quantized
  // `captureAt` on one side — that's the capture-leg floor, see config.now.)
  const stage = (xs: number[]) => ({
    p50: percentile(xs, 0.5),
    p95: percentile(xs, 0.95),
  });
  return {
    mean: latencies.reduce((sum, v) => sum + v, 0) / latencies.length,
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    p99: percentile(latencies, 0.99),
    samples: samples.length,
    stagePercentiles: {
      encodeFill: stage(encodeFill),
      fetch: stage(fetch),
      publish: stage(publish),
      wake: stage(wake),
    },
  };
}
