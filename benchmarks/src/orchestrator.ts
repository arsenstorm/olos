// OLOS benchmark orchestrator entry.
//
// Spawns N worker subprocesses (each one a full src/index.ts bench session
// with its own ffmpeg, port, and in-memory coordinator) and aggregates their
// progress into a single live panel. With N=1 this is a thin shim over one
// worker — same behavior as running src/index.ts directly, just routed
// through the same multi-process pipeline so there's only one code path.
//
// Workers emit one JSON line per sample to stdout (`{type:"slice",...}`) and
// one final `{type:"done",...}` line. orchestrator-worker.ts parses those,
// orchestrator-ui.ts renders the aggregate panel, and orchestrator-aggregate.ts
// reads the shared CSV at the end to compute the cross-worker stats.
//
// Why subprocesses rather than worker_threads: each session has its own
// ffmpeg child, its own loopback TLS server, and its own in-memory
// coordinator — there's no shared state to gain from threads. Subprocesses
// also give us hard CPU isolation per worker (kernel-scheduled), which is
// what we need to drive sample throughput on multi-core machines.

import { finalize } from "./orchestrator-aggregate";
import {
  CONCURRENCY,
  distributeSamples,
  TARGET_SAMPLES,
} from "./orchestrator-config";
import { multibar } from "./orchestrator-ui";
import {
  spawnWorker,
  type WorkerStatus,
  workerProcs,
} from "./orchestrator-worker";

function forwardSignal(signal: NodeJS.Signals): void {
  if (multibar !== undefined) {
    multibar.stop();
  }
  console.log(`\n[bench] ${signal} received, asking workers to drain…`);
  for (const proc of workerProcs) {
    try {
      proc.kill(signal === "SIGINT" ? "SIGINT" : "SIGTERM");
    } catch {
      // already dead
    }
  }
}

async function main(): Promise<void> {
  const distribution = distributeSamples(TARGET_SAMPLES, CONCURRENCY);
  const workerPromises = distribution.map((count, id) =>
    spawnWorker(id, count)
  );

  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));

  const statuses: WorkerStatus[] = await Promise.all(workerPromises);
  if (multibar !== undefined) {
    multibar.stop();
  }
  await finalize(statuses);
}

await main();
