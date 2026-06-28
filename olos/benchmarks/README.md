# OLOS benchmarks

End-to-end latency for OLOS, measured against **real H.264 video** pushed
through the **real** publish + manifest path — no mocks of the protocol itself.

```bash
bun run benchmark        # 30 fps, 100 ms LL-HLS parts, for 30 s
```

## What it does

A continuous `ffmpeg` encodes a live stream whose every frame carries its
capture wall-clock as a binary barcode. Each fragment is published through the
OLOS handler and served from a loopback media origin. A consumer chases the
manifest with blocking reload, fetches the newest fragment, and reads the
barcode back out:

```
latency = (fragment fetched) − (fragment's first-frame capture time)
```

This ffmpeg build has no `drawtext`, so the timestamp is a high-contrast
barcode rather than burned-in text — which also survives video compression
more reliably and needs no text recognition.

## Two modes

Set by `OLOS_BENCH_PART_MS`:

- **Parts (default).** Encoder runs at part cadence; producer publishes each
  fragment as an LL-HLS part (no segment commits — retention bounds the
  window through part commits alone). Consumer chases `_HLS_msn=N&_HLS_part=K`.
  This is the realistic LL-HLS path and exercises the part commit / cursor /
  manifest renderer that the protocol's hot path actually uses.
- **Segments only** (`OLOS_BENCH_PART_MS=0`). Encoder runs at segment cadence;
  producer publishes one segment per cycle. Useful as a baseline next to the
  parts number.

The `olos overhead p50` line in the report subtracts the fragment fill time
from p50 so you can see the OLOS-owned slice (slot grant + commit + cursor +
manifest render + wake) directly. That's the number worth comparing across
modes and across releases.

## What it measures (and what it doesn't)

Measures **encode → publish → manifest-visible → fetch**. It does **not** run a
real player, so it excludes the player's own buffering. The number therefore
reads *lower* than a production end-to-end figure — it isolates the path OLOS
owns.

The result is dominated by **fragment duration**: a fragment can't be
published until its last frame is encoded, so measuring from its first frame
inherently includes one fragment's fill. Shrink `OLOS_BENCH_PART_MS` (or
`OLOS_BENCH_SEGMENT_MS` in segments-only mode) to push the number down;
inspect the `olos overhead p50` line for OLOS's own contribution.

## Local only — $0

No R2/S3/AWS, no credentials, no network egress:

- in-memory coordinator store
- fake S3 clients — the client only presigns locally and is never sent to;
  uploaded bytes live in an in-memory `Map`
- loopback TLS media origin on `127.0.0.1` (self-signed cert, generated per run)

`createLocalOlos` asserts the media origin is loopback, so the benchmark can't
drift into hitting a real bucket. External processes are local `ffmpeg`,
`ffprobe`, and `openssl` only.

## Files

| File | Concern |
| --- | --- |
| `barcode.ts` | The probe — timestamp ⇄ video-frame codec. Run it directly to self-check. |
| `harness.ts` | The rig — ffmpeg encode/decode + local OLOS (handler, fakes, media origin, publish). |
| `index.ts` | The scenario — config, producer/consumer, report. |

## Knobs

| Env var | Default | Meaning |
| --- | --- | --- |
| `OLOS_BENCH_FPS` | `30` | Source frame rate. |
| `OLOS_BENCH_DURATION_S` | `30` | How long to stream. |
| `OLOS_BENCH_PART_MS` | `100` | Part duration. Must divide `SEGMENT_MS` evenly, and `PART_MS * FPS / 1000` must be integer (else the muxer cuts between keyframes and breaks decode). `0` switches to segments-only mode. |
| `OLOS_BENCH_SEGMENT_MS` | `500` | Segment duration. In parts mode, defines the LL-HLS segment window the manifest renderer rolls over. |
| `OLOS_BENCH_CRF` | `18` | x264 quality (lower = crisper barcode). |
| `OLOS_BENCH_PORT` | `8799` | Loopback media-origin port. |
