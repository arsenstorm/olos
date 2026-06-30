// Spawns one worker subprocess, parses its stdout JSON-line stream
// (`{type:"slice"}` and `{type:"done"}`), and resolves with the final
// WorkerStatus once the worker exits. The orchestrator's main fan-out is
// just `Promise.all(distribution.map(spawnWorker))`.

import { spawn } from "bun";
import { BASE_PORT, RUN_ID, WORKER_ENTRY } from "./orchestrator-config";
import { createWorkerBar, recordSlice, renderPanel } from "./orchestrator-ui";

export interface WorkerStatus {
  done: boolean;
  interrupted: boolean;
  runId: string;
  samples: number;
  sidecarPath?: string;
  target: number;
}

interface WorkerMessage {
  interrupted?: boolean;
  olosSliceMs?: number;
  samples?: number;
  seq?: number;
  sidecarPath?: string;
  type: "slice" | "done";
  workerId: string;
}

export const workers: WorkerStatus[] = [];
export const workerProcs: ReturnType<typeof spawn>[] = [];

export function spawnWorker(
  workerId: number,
  samples: number
): Promise<WorkerStatus> {
  const port = BASE_PORT + workerId;
  const workerRunId = `${RUN_ID}-w${workerId}`;
  const status: WorkerStatus = {
    done: false,
    interrupted: false,
    runId: workerRunId,
    samples: 0,
    target: samples,
  };
  workers.push(status);
  createWorkerBar(workerId, samples);

  const proc = spawn(["bun", "run", WORKER_ENTRY], {
    env: {
      ...process.env,
      OLOS_BENCH_PORT: String(port),
      OLOS_BENCH_RUN_ID: workerRunId,
      OLOS_BENCH_SAMPLES: String(samples),
      OLOS_BENCH_WORKER_ID: String(workerId),
    },
    stderr: "inherit",
    stdout: "pipe",
  });
  workerProcs.push(proc);

  return drainStdout(proc, status).then(async () => {
    await proc.exited;
    status.done = true;
    return status;
  });
}

async function drainStdout(
  proc: ReturnType<typeof spawn>,
  status: WorkerStatus
): Promise<void> {
  if (proc.stdout === null) {
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith("{")) {
        try {
          handleWorkerMessage(status, JSON.parse(line) as WorkerMessage);
        } catch {
          // Malformed JSON — ignore; orchestrator must not crash on noise.
        }
      }
      nl = buffer.indexOf("\n");
    }
    renderPanel(workers);
  }
}

function handleWorkerMessage(status: WorkerStatus, msg: WorkerMessage): void {
  if (msg.type === "slice") {
    if (typeof msg.olosSliceMs === "number") {
      recordSlice(msg.olosSliceMs);
    }
    if (typeof msg.seq === "number") {
      status.samples = msg.seq + 1;
    }
    return;
  }
  if (msg.type === "done") {
    if (typeof msg.samples === "number") {
      status.samples = msg.samples;
    }
    status.sidecarPath = msg.sidecarPath;
    status.interrupted = msg.interrupted === true;
  }
}
