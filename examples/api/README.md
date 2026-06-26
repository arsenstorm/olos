# `examples/api`

A Cloudflare Worker that mounts the OLOS S3 runtime handler over a Durable
Object backed coordinator store. Uploads land in MinIO locally and in a real
R2 bucket in production — the Worker code does not change.

## What it shows

- Mounting `createStoredS3CoordinatorRuntimeHandler` from `olos/s3` as a Worker
  fetch handler.
- A `StreamCoordinator` Durable Object implementing the
  `SerializedCoordinatorStoreBackend` contract with conditional ETag writes —
  one DO instance per session.
- LL-HLS blocking reload (`_HLS_msn=N`) backed by in-DO cursor waiters, so a
  playback request that asks for a segment one beyond the live edge returns as
  soon as the next commit lands.
- The S3 client (`@aws-sdk/client-s3`) pointed at a configurable endpoint:
  MinIO for local dev, R2's S3-compatible endpoint for production.

## What it intentionally does not show

- Multiple renditions.
- LL-HLS `#EXT-X-PART` parts (segments only).
- Recovery and retention jobs (`/s3/reconcile-plan`, `/s3/reconcile`,
  `/s3/retention`). The routes are mounted by the OLOS handler; cron wiring is
  left to the application.
- Publisher heartbeat/lease, tenant or viewer auth (single ingest bearer only).
- CDN-fronted direct-public media bucket. The Worker proxies `GET /media/:key`
  for demo simplicity; production should put the bucket behind a custom domain
  and remove this route.
- TLS for local dev. `MEDIA_ORIGIN` must be `https://...` to satisfy OLOS, but
  the Worker actually serves `http://localhost:8787`. Manifests embed the
  HTTPS placeholder — fine for asserting flow, not for playback in a browser.

## Local dev

Prerequisites: Bun, Docker (for MinIO), Node ≥22.18 (for Wrangler deploy),
and a workspace install at the repo root (`bun install`).

```bash
cd examples/api
cp .dev.vars.example .dev.vars
docker compose up -d           # MinIO + bucket bootstrap
bun run dev                    # vite dev (Cloudflare plugin) on :8787
```

### Drive a session

Two paths, depending on what you have on hand:

**Real video (canonical):** run `examples/streamer` in another shell to bridge
OBS → RTMP → ffmpeg → OLOS, then `examples/player` to play it back in a
browser. The streamer publishes 500 ms LL-HLS parts (synthesised from
ffmpeg micro-segments) plus 2 s segment finalisations, so the Worker
serves a real `#EXT-X-PART` manifest and hls.js's LL-HLS blocking-reload
path is what closes the loop. See those READMEs for setup.

**No external dependencies (smoke test):** run the publish-demo script in
another shell:

```bash
cd examples/api
bun run publish-demo
```

The demo creates a session, publishes an init object plus three segments, then
opens an LL-HLS blocking reload request (`_HLS_msn=N+1`) concurrently with the
final commit and asserts that the reload returns within the timeout with the
new segment listed. It's the only programmatic check that the in-DO cursor
waiter wired through `createCursorWaiter` actually wakes the blocking
manifest handler — useful when iterating on `coordinator-do.ts` or
`cursor-notifier.ts` without having to spin up OBS.

## Production deployment

Switch the S3 client to your R2 bucket. The Worker is unchanged.

```bash
# R2 S3 endpoint is https://<account-id>.r2.cloudflarestorage.com
wrangler secret put S3_ENDPOINT_URL
wrangler secret put S3_ACCESS_KEY_ID
wrangler secret put S3_SECRET_ACCESS_KEY
wrangler secret put INGEST_KEY

# Edit wrangler.jsonc vars.MEDIA_ORIGIN to your viewer-facing origin and
# vars.S3_BUCKET to the R2 bucket name, then:
bun run deploy                 # vite build && wrangler deploy
```

For a real production posture, also: front R2 with a custom domain, drop the
`GET /media/*` proxy route, gate ingest by per-publisher auth (replace the
demo bearer with mTLS or signed JWTs), and run reconciliation + retention on a
cron trigger using the OLOS handler's `/s3/reconcile` and `/s3/retention`
routes.

## Files

- `src/index.ts` — Worker entry; composes the OLOS handler.
- `src/coordinator-do.ts` — `StreamCoordinator` Durable Object: store backend
  plus in-memory cursor waiters.
- `src/coordinator-store.ts` — adapter routing OLOS store calls to the DO.
- `src/cursor-notifier.ts` — adapter forwarding `waitForCursor` to the DO.
- `src/s3-client.ts` — `@aws-sdk/client-s3` factory.
- `src/media-proxy.ts` — `GET /media/:key` proxy (demo-only).
- `scripts/publish-demo.ts` — smoke test: publishes fixture bytes and asserts
  the LL-HLS blocking-reload path returns when the next commit lands.
- `vite.config.ts` — Vite + `@cloudflare/vite-plugin` (classic mode).
- `wrangler.jsonc` — bindings, DO migrations, vars.
- `docker-compose.yml` — MinIO + bucket bootstrap.

## Types

Bindings are typed by `wrangler types`, which writes
`worker-configuration.d.ts` (gitignored) from `wrangler.jsonc`. Vars come
through as literal strings; secrets declared under `secrets.required` come
through as `string`. Worker code references the ambient `Env` directly — no
hand-maintained interface. Re-generate after editing `wrangler.jsonc`:

```bash
bun run gen-types
```

`bun run check-types` runs `wrangler types` first, then `tsc --noEmit`.

## Why Vite + `wrangler.jsonc`, not `cloudflare.config.ts`

`@cloudflare/vite-plugin` ships an experimental TS config mode
(`cloudflare.config.ts` + `wrangler.config.ts`) that would let bindings be
typed from a `defineWorker` call directly — no `wrangler types` step. As of
`@cloudflare/vite-plugin@1.42`, that mode rejects same-Worker Durable Object
exports with `"Durable Object exports are not currently supported."` Since
OLOS's coordinator store backend is exactly that, this example stays on
`wrangler.jsonc` and will migrate once the plugin gains DO export support.
