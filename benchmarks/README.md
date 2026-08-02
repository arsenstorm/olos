# OLOS benchmarks

Glass-to-glass latency harness for OLOS. It measures how long a video frame
takes to travel from capture to render through a real encode → publish →
LL-HLS → decode pipeline, with every OLOS stage timestamped along the way.

## What it measures

Each generated frame carries its capture wall-clock encoded as a
high-contrast barcode (`src/barcode.ts`: 48 data bits of epoch milliseconds,
sized to survive H.264 4:2:0 subsampling). The pipeline is:

1. A frame timer paints barcode frames and feeds them to a real `ffmpeg`
   H.264 encoder producing fMP4 fragments.
2. The producer publishes each fragment (init, parts, segments) through an
   in-memory local OLOS coordinator (`src/local-olos.ts`) — the real
   `createStoredS3CoordinatorRuntimeHandler` from `@arsenstorm/olos/s3`, with
   uploaded bytes held in a Map and served from a loopback TLS media origin
   on `127.0.0.1`.
3. The consumer plays the stream back over LL-HLS blocking reload
   (`_HLS_msn`), fetching manifests and media exactly like a player would.
4. A pool of streaming ffmpeg decoders reads the barcode back out of the
   rendered frames, recovering the original capture time.

Because the capture clock rides inside the frame itself, no encoder
start-clock calibration is needed. Every sample records five timestamps —
`captureAt`, `uploadedAt`, `committedAt`, `playlistVisibleAt`, `renderedAt` —
which the report aggregates into per-stage percentiles:

| Stage | Definition |
| --- | --- |
| encode fill | `uploadedAt − captureAt` |
| publish | `committedAt − uploadedAt` |
| wake | `playlistVisibleAt − committedAt` |
| fetch | `renderedAt − playlistVisibleAt` |
| glass-to-glass | `renderedAt − captureAt` |

Everything runs on one machine. No S3/R2 account, no credentials, no egress:
the S3 client only presigns URLs locally and is never sent to.

## Prerequisites

- `ffmpeg` on PATH (encode and decode).
- `openssl` on PATH (generates the self-signed loopback certificate).
- A workspace install and build at the repository root:

```bash
bun install
bun run build
```

The workspace `@arsenstorm/olos` dependency resolves to `olos/dist/`, so the
package must be built before the harness can import it.

## Run

```bash
cd benchmarks
bun run benchmark          # orchestrator: N concurrent worker sessions
bun run benchmark:worker   # a single session, no orchestrator
```

`bun run benchmark` (`src/orchestrator.ts`) spawns `OLOS_BENCH_CONCURRENCY`
worker subprocesses — each a full bench session with its own ffmpeg, port
(`OLOS_BENCH_PORT + workerId`), and in-memory coordinator — splits the sample
target across them, and aggregates their progress into one live panel. With
the default concurrency of 1 it is a thin shim over a single worker.

`bun run benchmark:worker` (`src/index.ts`) runs one session directly with a
live terminal UI. `SIGINT`/`SIGTERM` drain the decoder pool cleanly, so an
interrupted run still writes its results.

## Environment

All knobs are `OLOS_BENCH_*` environment variables.

| Var | Default | Notes |
| --- | --- | --- |
| `OLOS_BENCH_CONCURRENCY` | `1` | Orchestrator only: number of concurrent worker sessions (clamped to ≥ 1). |
| `OLOS_BENCH_SAMPLES` | `1000` | Target sample count; the orchestrator splits it across workers. |
| `OLOS_BENCH_FPS` | `30` | Barcode frame rate fed to the encoder. |
| `OLOS_BENCH_SEGMENT_MS` | `500` | Segment duration. Must be a multiple of `OLOS_BENCH_PART_MS` when parts are enabled. |
| `OLOS_BENCH_PART_MS` | `100` | Part duration. Parts are enabled when `0 < PART_MS < SEGMENT_MS`; otherwise the run is segments-only. |
| `OLOS_BENCH_CRF` | `18` | x264 CRF for the encode leg. |
| `OLOS_BENCH_PORT` | `8799` | Loopback TLS media-origin port. The orchestrator assigns `PORT + workerId` per worker. |
| `OLOS_BENCH_DECODE_CONCURRENCY` | `4` | Size of the streaming ffmpeg decode pool. |
| `OLOS_BENCH_RUN_ID` | start time (ISO) | Run identifier stamped into CSV rows and the sidecar filename. Set by the orchestrator per worker. |
| `OLOS_BENCH_WORKER_ID` | unset | Set by the orchestrator. Presence switches worker mode: live UI off, one JSON line per sample on stdout. |

## Outputs

Both outputs are gitignored (see `.gitignore`: `results.csv`, `runs/`).

- `results.csv` — append-only per-sample log, shared across runs and
  workers. Header:
  `runId,workerId,seq,msn,partNumber,captureAt,uploadedAt,committedAt,playlistVisibleAt,renderedAt,latencyMs`.
- `runs/<runId>.json` — one sidecar per run with the config knobs, machine
  info (CPU, memory, Bun/Node versions), the repo commit when available,
  and the aggregated percentile results.

A non-worker run also prints a text report: end-to-end p50/p95/p99/mean,
estimated OLOS overhead (p50 minus the fragment duration), and the per-stage
breakdown.

## Local-only TLS

The harness is loopback-only by construction, and two guards keep it that
way:

- `src/index.ts` sets `NODE_TLS_REJECT_UNAUTHORIZED=0` **process-wide**
  before importing the harness, so the consumer accepts the self-signed
  loopback certificate without wiring a trust store (and the harness module
  itself stays side-effect-free for other importers).
- `assertLoopback` (`src/cert.ts`) rejects any media origin whose host is
  not `127.0.0.1` or `localhost`.

Because certificate verification is disabled for the whole process, the
harness must never be pointed at a remote origin. It is a measurement rig,
not a client.

## Reference numbers

Reference numbers come from a curated committed baseline, not from ad-hoc
runs. No baseline has been committed yet, so the table below is a skeleton.

_pending first curated baseline run_

| Stage | p50 | p95 | p99 |
| --- | --- | --- | --- |
| capture → uploaded (encode fill) | — | — | — |
| uploaded → committed (publish) | — | — | — |
| committed → playlist-visible (wake) | — | — | — |
| playlist-visible → rendered (fetch) | — | — | — |
| glass-to-glass | — | — | — |

To establish (or refresh) the baseline:

1. Run `bun run benchmark` on an otherwise idle machine with default knobs.
2. Copy the run sidecar from `runs/<runId>.json` to
   `benchmarks/results/baseline.json`.
3. Record the machine spec alongside it: CPU model, RAM, OS, Bun version,
   ffmpeg version, the config knobs used, and the commit SHA (the sidecar
   already captures most of these).
4. Update the table above from the sidecar's aggregated percentiles and
   remove the pending marker.
