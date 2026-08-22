// Text-report sections shared by the single-worker report (reporting.ts) and
// the cross-worker aggregate report (orchestrator-aggregate.ts).

import os from "node:os";
import type { AggregateStats } from "./stats";

const fmt = (ms: number) => `${ms.toFixed(3)} ms`;

export function hostLine(): string {
  return `  host              : ${os.platform()} ${os.arch()} ${os.cpus()[0]?.model ?? "?"}`;
}

export function printLatencySummary(
  results: AggregateStats,
  fragmentMs: number
): void {
  const overheadMs = Math.max(0, results.p50 - fragmentMs);
  console.log("End-to-end latency (renderedAt − captureAt):");
  console.log(`  p50               : ${fmt(results.p50)}`);
  console.log(`  p95               : ${fmt(results.p95)}`);
  console.log(`  p99               : ${fmt(results.p99)}`);
  console.log(`  mean              : ${fmt(results.mean)}`);
  console.log(`  olos overhead p50 : ~${fmt(overheadMs)}  (p50 − fragment ms)`);
  console.log("");
}

export function printStages(results: AggregateStats): void {
  console.log("Stage breakdown (percentiles per stage):");
  const stages: [string, { p50: number; p95: number }, string][] = [
    [
      "encode fill",
      results.stagePercentiles.encodeFill,
      "uploadedAt − captureAt",
    ],
    ["publish", results.stagePercentiles.publish, "committedAt − uploadedAt"],
    ["wake", results.stagePercentiles.wake, "visibleAt − committedAt"],
    ["fetch", results.stagePercentiles.fetch, "renderedAt − visibleAt"],
  ];
  for (const [name, pct, desc] of stages) {
    console.log(
      `  ${name.padEnd(18)}: p50 ${fmt(pct.p50)}  p95 ${fmt(pct.p95)}  (${desc})`
    );
  }
  console.log("");
}

export function printBenchNote(): void {
  console.log(
    "Note: `publish` tail in this single-process bench reflects JS event-loop"
  );
  console.log(
    "contention between producer and consumer sharing the same handler — see"
  );
  console.log("README for why production deploys don't see this term.");
  console.log("");
}
