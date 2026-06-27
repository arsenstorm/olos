# OLOS

[![Socket](https://socket.dev/api/badge/npm/package/@arsenstorm/olos)](https://socket.dev/npm/package/@arsenstorm/olos)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/arsenstorm/olos/badge)](https://scorecard.dev/viewer/?uri=github.com/arsenstorm/olos)

Open Live Object Streaming protocol primitives. A low-latency append-only
stream log over plain object storage (S3, R2, GCS).

## Install

```bash
npm install @arsenstorm/olos
```

## Imports

```ts
import { OLOS_PROTOCOL_NAME, OLOS_WIRE_VERSION } from "@arsenstorm/olos";
import type { Session } from "@arsenstorm/olos/types";
```

| Subpath | Use for |
| --- | --- |
| `@arsenstorm/olos/runtime` | Session routes, publisher loops, HLS serving. |
| `@arsenstorm/olos/s3` | S3 upload grants, observation, events, recovery, retention. |
| `@arsenstorm/olos/hls` | HLS rendering and blocking-reload helpers. |
| `@arsenstorm/olos/protocol` | Coordinator stores and adapter conformance. |
| `@arsenstorm/olos/state` | Lower-level state transitions and policies. |
| `@arsenstorm/olos/schema` | JSON Schemas for wire objects. |
| `@arsenstorm/olos/validation` | Runtime payload validators. |
| `@arsenstorm/olos/types` | Public protocol data types. |
| `@arsenstorm/olos/config` | Protocol constants and policy defaults. |
| `@arsenstorm/olos/conformance` | Assertion metadata and store checks. |

## Quick start

A complete OLOS endpoint with S3-backed live media:

```ts
import {
  createMemorySerializedCoordinatorStoreBackend,
  createSerializedCoordinatorStore,
} from "@arsenstorm/olos/protocol";
import { createStoredS3CoordinatorRuntimeHandler } from "@arsenstorm/olos/s3";
import { S3Client } from "@aws-sdk/client-s3";

const store = createSerializedCoordinatorStore(
  createMemorySerializedCoordinatorStoreBackend()
);

const s3 = new S3Client({ region: "us-east-1" });

const handleOlos = createStoredS3CoordinatorRuntimeHandler({
  allowedMediaOrigins: ["https://media.example.com"],
  bucket: "olos-media",
  client: s3,
  expiresInSeconds: 5,
  providerId: "s3_primary",
  store,
});

export default { fetch: (req: Request) => handleOlos(req) };
```

Publishers create a session, then loop: get a presigned slot, PUT media bytes
to S3, post a commit. Viewers GET HLS manifests. The handler covers it.

Working setups:

- [examples/api](https://github.com/arsenstorm/olos/tree/main/examples/api) — Cloudflare Worker + Durable Object + R2.
- [examples/streamer](https://github.com/arsenstorm/olos/tree/main/examples/streamer) — OBS-to-OLOS bridge using ffmpeg micro-segments.
- [examples/player](https://github.com/arsenstorm/olos/tree/main/examples/player) — LL-HLS player at the PART-HOLD-BACK spec floor.

## Routes

The handler mounts:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/sessions` | Create a session. |
| `POST` | `/sessions/:id/s3/slots` | Issue a presigned upload slot. |
| `POST` | `/sessions/:id/s3/commits` | Observe and commit an upload. |
| `POST` | `/sessions/:id/s3/events` | Accept S3 object-created events. |
| `POST` | `/sessions/:id/s3/reconcile-plan` | List in-flight slots for recovery. |
| `POST` | `/sessions/:id/s3/reconcile` | Recover slots after missed events. |
| `POST` | `/sessions/:id/s3/retention` | Plan and delete retired media. |
| `POST` | `/sessions/:id/transition` | Advance session state. |
| `POST` | `/sessions/:id/heartbeat` | Publisher liveness ping. |
| `GET` | `/sessions/:id/health` | Live / starting / stale summary. |
| `GET` | `/v1/live/:id/.../media.m3u8` | LL-HLS playlist with `_HLS_msn` blocking reload. |

## Layers

OLOS is a layered protocol. Each layer answers a different question and can
be reused, extended, or replaced independently.

**Core.** What makes an uploaded object an officially committed part of the
live stream. Slots, observations, commits, cursors, `CommittedWindow`. The
invariant: object exists ≠ object is stream state. Media-agnostic; no HLS,
no S3, no HTTP.

**LL-HLS Profile.** How the committed window renders into a playable
LL-HLS manifest with blocking reload. Currently video-first;
`RENDITION_KINDS` is open to audio / text / metadata for future profiles.

**S3-Compatible Binding.** The minimum a storage backend must provide:
exact-key uploads, conditional create, `HeadObject` consistency, optional
event notifications. Works with S3, R2, GCS-S3, or any compatible store.

**Direct-Public Deployment Profile.** The configuration that says committed
media bytes are served directly from the media origin. Requires a
cookieless media origin, negative cache for 404s, and no document
navigation to media URLs. The manifest is the gate.

**Runtime Guidance.** Heartbeats, retention, reconciliation, live health,
publisher loops. The operational glue that lives in the runtime layer, not
in the protocol-essential commit semantics.

**OLOS owns** slot rules, commit idempotency, S3 object observation, cursor
sequencing, manifest rendering, retention planning, blocking-reload boundary,
and the conformance suite.

**Your app owns** authentication, the coordinator store backend, S3
credentials, cursor wake-up mechanism, publisher scheduling, viewer routing,
cache purge, and tenant quotas.

## Further reading

- [Production pipeline](https://github.com/arsenstorm/olos/blob/main/contributing/core/production-pipeline.md) — wiring a real deployment.
- [Store adapters](https://github.com/arsenstorm/olos/blob/main/contributing/core/store-adapters.md) — coordinator store on SQL, KV, or Durable Objects.
- [Direct-public deployment](https://github.com/arsenstorm/olos/blob/main/contributing/core/direct-public-deployment.md) — when uploaded media is readable before the manifest gates it.
- [Conformance](https://github.com/arsenstorm/olos/blob/main/contributing/core/conformance.md) — assertion catalogue covering the protocol surface.

## Release check

```bash
bun --filter '@arsenstorm/olos' publish:check
```
