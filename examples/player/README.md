# `examples/player`

Minimal browser player for an OLOS live stream. Single static HTML page
served by Bun on `http://localhost:8788/`; uses [hls.js](https://github.com/video-dev/hls.js)
(loaded from a CDN) with LL-HLS enabled to play the manifest served by the
`examples/api` Worker.

## Prerequisites

- Bun
- The `examples/api` Worker running on `http://localhost:8787`
- A live session to watch — either `examples/streamer` connected from OBS,
  or `examples/api/scripts/publish-demo.ts` for fixture bytes

## Run

```bash
cd examples/player
bun run start          # → http://localhost:8788/
```

Open the page, paste the session ID printed by the streamer (or the demo
script), click Play. The log pane shows part and segment loads as they
arrive.

## What it does

- Fetches `http://localhost:8787/v1/live/:session/:rendition/media.m3u8`
  through hls.js with `lowLatencyMode: true`, `liveSyncDuration: 0.5`, and
  `maxLiveSyncPlaybackRate: 1.5`. With `examples/streamer` producing 500 ms
  LL-HLS parts, hls.js's blocking-reload path holds requests open for
  `_HLS_msn=N&_HLS_part=M` until OLOS commits that part — typical
  end-to-end glass-to-glass latency on the local stack is ~1.5–2.5 s.
- Wraps hls.js's default loader to rewrite segment URLs: OLOS bakes the
  configured `MEDIA_ORIGIN` (`https://localhost:8787`) into the manifest,
  but the local Worker actually serves over HTTP. The loader swaps the
  protocol for any same-host URL so playback works without setting up a
  local HTTPS cert.
- Falls back to native HLS playback (`video.src = manifestUrl`) if hls.js
  isn't supported — Safari plays the manifest directly.

## What it intentionally doesn't show

- Multi-rendition / quality selection.
- Buffer health / stats UI.
- Custom controls. Uses the default `<video controls>`.
- Auth. Manifest and media routes are public; this would not be true in
  production direct-public mode (use signed URLs, cache rules, etc.).

## Latency expectations

| Stage | ~Time |
| --- | --- |
| OBS encodes 0.5 s, ffmpeg writes the part `.m4s` | 0.5 s |
| streamer reads + PUTs to MinIO + commits part with byterange | ~0.2 s |
| hls.js holds Range request via `EXT-X-PRELOAD-HINT`, Worker streams bytes | ~0.1 s |
| hls.js decodes + plays one part behind live | ~0.4 s |

Target glass-to-glass: **~2 s** with the byterange LL-HLS path. OLOS now
emits `#EXT-X-PART:BYTERANGE="L@O"` against a virtual segment URL and a
`#EXT-X-PRELOAD-HINT:TYPE=PART,BYTERANGE-START=N` line after the last
in-progress part; the Worker's `/v/:session/:rendition/:msn.m4s` route
aggregates part objects from S3 and holds the response open until the
next commit lands. Sub-second latency would require WebRTC; HLS-compatible
clients (browsers + Apple ecosystem + every modern player) plug into this
unchanged.

## CORS

The Worker (`examples/api/src/index.ts`) adds
`Access-Control-Allow-Origin: *` to every response under `/v1/live/*` and
`/media/*`, plus an OPTIONS short-circuit. Without that, the browser
would block the cross-origin fetch from `localhost:8788` to
`localhost:8787`.

## Files

- `index.html` — single-page player. Loads hls.js from jsDelivr.
- `src/serve.ts` — Bun static server on port 8788.
