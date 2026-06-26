# `examples/streamer`

OBS → RTMP → `ffmpeg` → **LL-HLS** → OLOS bridge. Accepts one RTMP stream,
transmuxes it to fragmented MP4 chunks with ffmpeg, and publishes those
chunks to OLOS as both per-part commits (`#EXT-X-PART`) and per-segment
commits (`#EXTINF`).

## How byte-range LL-HLS is synthesized

ffmpeg's HLS muxer doesn't support LL-HLS parts natively (no
`-hls_part_size` or `-hls_part_time` exists in upstream ffmpeg). This
example synthesises spec-compliant byte-range LL-HLS on top of ffmpeg:

1. Tells ffmpeg to emit a fresh fMP4 segment every **0.5 s**
   (`-hls_time 0.5`), giving a stream of micro-segments
   `part-00000.m4s`, `part-00001.m4s`, …
2. Treats each micro-segment as an OLOS **byterange part**:
   - `mediaSequenceNumber = floor(index / 4)` — 4 parts per logical 2 s segment
   - `partNumber = index % 4`
   - `byterange.offset = sum of previous parts' bytes in this segment`
   - `byterange.length = bytes.length`
   - `byterange.segmentObjectKey = live/<sid>/<rendition>/<msn>.m4s` (logical)
   - `byterange.segmentDeliveryUrl = <MEDIA_ORIGIN>/v/<sid>/<rendition>/<msn>.m4s`
3. Publishes the part as its own S3 object AND a part commit with that
   byterange. OLOS renders `#EXT-X-PART:BYTERANGE="L@O",URI="<virtual>"`
   instead of a per-part URL, and emits a
   `#EXT-X-PRELOAD-HINT:TYPE=PART,BYTERANGE-START=N` after the last
   committed part of the in-progress segment.
4. When the 4th part lands, concatenates the four part files and
   publishes an OLOS segment commit.

The **Worker's `/v/:session/:rendition/:msn.m4s` route** aggregates the
per-part S3 objects on the fly to satisfy Range requests against the
virtual segment URL. If a Range extends past committed parts, the Worker
holds the response open via the per-session DO cursor waiter until the
next commit lands — the `EXT-X-PRELOAD-HINT` mechanism.

End-to-end glass-to-glass latency on a local stack: **~1.5–2.5 s**, with
the manifest looking exactly like Apple's reference LL-HLS form.

### Why not Shaka Packager?

The byte-range LL-HLS spec is encoder-agnostic — what matters is the
manifest format. ffmpeg micro-segments + synthetic byterange offsets
produce a wire-format-compliant manifest at the cost of byte alignment
being driven by ffmpeg segment boundaries rather than true CMAF chunk
boundaries. For a 0.5 s part target this is indistinguishable on the
wire. Swapping ffmpeg for Shaka Packager (or another CMAF-aware
packager) is a single-file change in `src/ffmpeg.ts` if you want true
chunked output later.

## Prerequisites

- Bun
- `ffmpeg` on PATH (`brew install ffmpeg`, `apt install ffmpeg`, etc.)
- The `examples/api` Worker running (`bun run dev` in `examples/api`)
- MinIO running (`docker compose up -d` in `examples/api`)

## Run

```bash
cd examples/streamer
bun run start
```

Output once OBS connects:

```
session obs_1719411923000
work dir /var/folders/xx/.../olos-streamer-XXXXXX
OBS → rtmp://localhost:1935/live (any stream key)
OBS keyframe interval must be 0.5s for LL-HLS parts
...
published init (XXXB)
part msn=0 part=0 (XXXXB)
part msn=0 part=1 (XXXXB)
part msn=0 part=2 (XXXXB)
part msn=0 part=3 (XXXXB)
segment msn=0 (XXXXB)
part msn=1 part=0 (XXXXB)
...
```

## OBS configuration

**Settings → Stream**
- Service: Custom
- Server: `rtmp://localhost:1935/live`
- Stream Key: anything (ignored)

**Settings → Output → Streaming**
- Video bitrate: 5000 Kbps (or whatever)
- **Keyframe interval: 0.5 seconds.** Required so every micro-segment
  starts on a keyframe and qualifies as `INDEPENDENT=YES`. Without this
  ffmpeg will either stall waiting for the next keyframe (segments grow
  beyond 0.5 s) or `+split_by_time` will cut between keyframes and the
  resulting parts won't decode standalone.
- Encoder: x264 (or any H.264). For x264, set tune = zerolatency.
- Audio: AAC

Click **Start Streaming**.

## Without OBS

Push a media file with forced keyframes every 0.5 s:

```bash
ffmpeg -re -i some-clip.mp4 \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -force_key_frames "expr:gte(t,n_forced*0.5)" \
  -c:a aac \
  -f flv rtmp://localhost:1935/live
```

## Environment

| Var | Default | Notes |
| --- | --- | --- |
| `RTMP_PORT` | `1935` | ffmpeg listens here for the OBS connection |
| `BASE_URL` | `http://localhost:8787` | The `examples/api` Worker |
| `INGEST_KEY` | `dev-key` | Must match `examples/api/.dev.vars` |
| `MEDIA_ORIGIN` | `https://localhost:8787` | Goes into pathway `baseUrl` |
| `SESSION_ID` | `obs_<ms>` | Override to resume a session |

## What it intentionally does not show

- Multiple renditions / bitrate ladder.
- Re-encode at the streamer side. `-c:v copy -c:a copy` passes OBS
  H.264 + AAC through. If your encoder uses a different codec, ffmpeg
  will fail at startup.
- Byte-range LL-HLS parts (Apple's preferred form). OLOS's `CommittedPart`
  expects one URL per part, so we publish each part as its own S3 object
  rather than as a byte range inside the segment file. The wire result
  is identical from hls.js's perspective; the cost is more S3 round-trips.
- `#EXT-X-PRELOAD-HINT`. OLOS's manifest renderer can emit it, but it's
  not wired up in `examples/api`.
- Concurrent streams. `ffmpeg -listen 1` accepts exactly one RTMP
  connection then exits; re-run for the next stream.
- Publisher heartbeat / lease.
- Recovery on streamer crash (the session is left in `live` until a
  future reconciliation run).

## Files

- `src/index.ts` — main loop: creates session, spawns ffmpeg, polls the
  output dir, publishes init + parts + assembled segments in order,
  transitions to `ending`.
- `src/ffmpeg.ts` — argv builder for ffmpeg in HLS-fMP4 listen mode with
  500 ms micro-segments.
- `src/olos-client.ts` — wraps `olos/s3` client helpers for create-session,
  publish-init, publish-part, publish-segment, end-session.

## Troubleshooting

- **`Library not loaded: libx265.215.dylib`** — homebrew's x265 needs
  reinstall (`brew reinstall x265`). We don't decode H.265, but ffmpeg
  loads the lib on startup.
- **OBS connects then immediately disconnects** — keyframe interval is
  the usual culprit. Set OBS keyframe interval to **0.5 seconds**.
- **Parts arrive at >0.5 s intervals** — your encoder isn't emitting
  keyframes every 0.5 s. ffmpeg with `+split_by_time` will still chunk,
  but those parts may not decode independently in hls.js.
- **`PUT … 403`** — MinIO bucket policy. `docker compose down -v && up -d`
  to re-bootstrap.
- **OLOS 400 on slot/commit** — the streamer prints the full OLOS error
  body via its top-level catch handler; check `code` + `message`.
