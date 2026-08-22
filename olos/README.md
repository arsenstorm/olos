# OLOS

[![Socket](https://socket.dev/api/badge/npm/package/@arsenstorm/olos)](https://socket.dev/npm/package/@arsenstorm/olos)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/arsenstorm/olos/badge)](https://scorecard.dev/viewer/?uri=github.com/arsenstorm/olos)

Open Live Object Streaming protocol primitives. A generic live object
streaming protocol: a low-latency append-only stream log over plain object
storage (S3, R2, GCS), with CMAF/LL-HLS as its first profile.

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
| `@arsenstorm/olos/media` | CMAF/LL-HLS profile: media session/track/object profiles, validators, schemas, publisher pacing. |
| `@arsenstorm/olos/hls` | HLS rendering and blocking-reload helpers. |
| `@arsenstorm/olos/protocol` | Coordinator stores and adapter conformance. |
| `@arsenstorm/olos/state` | Lower-level state transitions and policies. |
| `@arsenstorm/olos/schema` | JSON Schemas for wire objects. |
| `@arsenstorm/olos/validation` | Runtime payload validators. |
| `@arsenstorm/olos/types` | Public protocol data types. |
| `@arsenstorm/olos/config` | Protocol constants and policy defaults. |
| `@arsenstorm/olos/conformance` | Assertion metadata and store checks. |

## Quick start

A complete OLOS endpoint with S3-backed live media (the CMAF/LL-HLS profile):

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
  allowedDeliveryOrigins: ["https://media.example.com"],
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

A session declares the profile it runs under and a profile per track. Core
treats `profile` objects as opaque; `@arsenstorm/olos/media` defines and
validates the CMAF/LL-HLS ones:

```ts
import { CMAF_LLHLS_PROFILE_ID } from "@arsenstorm/olos/media";

await fetch("https://olos.example.com/sessions", {
  body: JSON.stringify({
    deliveryBaseUrl: "https://media.example.com",
    session: {
      createdAt: new Date().toISOString(),
      epoch: 1,
      olos: "1.0",
      profile: { id: CMAF_LLHLS_PROFILE_ID, partTarget: 0.5, segmentTarget: 2 },
      sessionId: "session_1",
      state: "live",
      tracks: [
        {
          profile: { bitrate: 5_000_000, codec: "avc1.640028", kind: "video" },
          trackId: "v1080",
        },
      ],
    },
  }),
  headers: { "content-type": "application/json" },
  method: "POST",
});
```

Slot requests and commits carry the same kind of opaque `profile` object
(for LL-HLS: `{ duration, independent, programDateTime }`).

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
| `POST` | `/sessions/:id/s3/retention` | Prune retired state and delete retired media. |
| `POST` | `/sessions/:id/upload-slots/:slotId/complete` | Publisher completion hint (alternative to waiting for events). |
| `POST` | `/sessions/:id/transition` | Advance session state. |
| `POST` | `/sessions/:id/heartbeat` | Publisher liveness ping. |
| `GET` | `/sessions/:id/health` | Live / starting / stale summary. |
| `GET` | `/v1/live/:id/master.m3u8` | Master playlist (variants, audio groups). |
| `GET` | `/v1/live/:id/.../media.m3u8` | LL-HLS playlist with `_HLS_msn` blocking reload. |

The `/sessions` and `/v1/live` prefixes are the defaults. The handler's
`sessionPath` and `livePath` options configure them. Error responses always
carry `error.code` from the registered `OLOS_ERROR_CODES` set, next to
`error.message`.

## Layers

OLOS is a layered protocol. Each layer answers a different question and can
be reused, extended, or replaced independently.

**Core.** What makes an uploaded object an officially committed part of the
live stream. Slots, observations, commits, cursors, `CommittedWindow`. The
invariant: object exists ≠ object is stream state. Media-agnostic: Core
carries `profile` data opaquely and knows no durations, codecs, HLS, S3, or
HTTP.

**CMAF/LL-HLS Profile** (`@arsenstorm/olos/media`, `@arsenstorm/olos/hls`).
What the `profile` objects mean for media (segment and part targets, track
codecs, object durations) and how the committed window renders into a
playable LL-HLS manifest with blocking reload. Other profiles can define
their own `profile` vocabulary on top of the same Core.

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
