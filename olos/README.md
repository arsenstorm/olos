# OLOS

Open Live Object Streaming protocol primitives.

## Install

```bash
bun add olos
```

For npm or pnpm projects, install the same `olos` package with your package
manager.

## Imports

```ts
import { OLOS_PROTOCOL_NAME } from "olos";
import type { Session } from "olos/types";
```

`olos` keeps the root export small. Use subpath imports for the rest of the
package:

| Import | Use for |
| --- | --- |
| `olos/runtime` | Session routes, publisher loops, health, retention, and HLS serving. |
| `olos/s3` | S3-compatible upload grants, object observation, events, recovery, and retention deletion. |
| `olos/hls` | Direct HLS rendering and manifest response helpers. |
| `olos/schema` | JSON Schemas for public wire objects. |
| `olos/protocol` | Coordinator state, memory stores, serialized stores, and adapter conformance. |
| `olos/state` | Lower-level state transitions and publication policies. |
| `olos/types` | Public protocol data types. |
| `olos/validation` | Runtime validators for protocol payloads. |
| `olos/config` | Shared protocol constants and default policy values. |
| `olos/conformance` | Conformance assertion metadata and store checks. |

Root `olos` exports only protocol metadata constants. Do not add runtime,
provider, validation, or state helpers to the root entry point; put them behind
the narrowest relevant subpath. The packed-package smoke test enforces the root
runtime export list.

Use `olos/schema` when a service needs JSON Schema documents for API gateways,
typed clients, fixtures, or external conformance tooling:

```ts
import { OLOS_JSON_SCHEMAS, OLOS_SESSION_SCHEMA } from "olos/schema";
```

Runtime validation helpers remain in `olos/validation`; the schema export is a
portable wire-contract surface.

## First Object-Store Flow

For an S3-compatible live pipeline, wire the pieces in this order:

1. Create a coordinator store with conditional writes.
2. Create a session and pathways through `olos/runtime`.
3. Use `olos/s3` to issue exact-key upload grants.
4. Upload encoder bytes in your application.
5. Commit by observing the exact object with S3 `HeadObject` or a normalized
   object-created event.
6. Serve HLS manifests from coordinator state.
7. Run recovery and retention as application-owned jobs.

The package does not authenticate publishers or viewers, provision buckets,
schedule encoders, poll jobs, or choose a database.

## Stored Runtime Pipeline

`olos/runtime` provides provider-neutral helpers for HTTP services that keep
coordinator state in an application-owned store.

Runtime session creation expects protocol-ready `session` and `pathways`
objects. App-level source setup, tenant policy, encoder configuration, and
playback URL assembly belong above this package.

```ts
import {
  commitStoredCoordinatorUploadFromRequest,
  createStoredCoordinatorSession,
  issueStoredCoordinatorSlotFromRequest,
  planStoredCoordinatorRetention,
  serveStoredBlockingCoordinatorManifest,
  serveStoredCoordinatorManifest,
  transitionStoredCoordinatorSession,
} from "olos/runtime";

await createStoredCoordinatorSession({
  pathways,
  session,
  store,
});

// Request values may be Fetch Request instances or typed payload objects.
await issueStoredCoordinatorSlotFromRequest({
  request: initSlotRequest,
  sessionId: session.sessionId,
  store,
});
await issueStoredCoordinatorSlotFromRequest({
  request: segmentSlotRequest,
  sessionId: session.sessionId,
  store,
});

await commitStoredCoordinatorUploadFromRequest({
  request: initCommitRequest,
  sessionId: session.sessionId,
  store,
});
await commitStoredCoordinatorUploadFromRequest({
  request: segmentCommitRequest,
  sessionId: session.sessionId,
  store,
});

const media = await serveStoredCoordinatorManifest({
  allowedMediaOrigins: ["https://media.example.com"],
  partTarget: session.partTarget,
  request: "https://edge.example.com/v1/live/session_1/v1080/media.m3u8",
  segmentTarget: session.segmentTarget,
  sessionId: session.sessionId,
  store,
  targetLatency: 3,
});

const blockingMedia = await serveStoredBlockingCoordinatorManifest({
  allowedMediaOrigins: ["https://media.example.com"],
  partTarget: session.partTarget,
  request:
    "https://edge.example.com/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3811",
  segmentTarget: session.segmentTarget,
  sessionId: session.sessionId,
  store,
  targetLatency: 3,
  timeoutMs: 3000,
  waitForCursor: ({ signal }) =>
    cursorStore.waitForNext(session.sessionId, { signal }),
});

await transitionStoredCoordinatorSession({
  sessionId: session.sessionId,
  state: "ending",
  store,
});

const retention = await planStoredCoordinatorRetention({
  now: new Date().toISOString(),
  sessionId: session.sessionId,
  store,
});
```

The application owns authentication, request routing, persistence, cursor
wake-ups, object deletion, and retries. OLOS owns session transitions, slot
rules, commit idempotency, cursor updates, HLS responses, and retention
planning.

For single-process runtimes, `createMemoryRuntimeCursorNotifier` can connect
commit routes to blocking reload waits. Distributed deployments should provide a
notifier backed by their own queue, pub/sub, or durable runtime.

Use `createSerializedCoordinatorStore` to adapt a persistent JSON snapshot
backend into the coordinator store contract. Backend adapters should implement
conditional inserts and expected-etag updates; `assertSerializedCoordinatorStoreBackendConformance`
can verify that behavior.

`runRuntimePublisherUploadStep` models the publisher loop for one object: issue
a slot, let the app upload to its provider, then commit the observed upload.
The application still owns encoder timing, bytes, retries, and credentials.
`resolveRuntimePublisherLoopDecision` maps a completed step into `continue`,
`retry`, or `stop` so applications can keep retry policy explicit.

`createRuntimePublisherLease`, `refreshRuntimePublisherLease`, and
`resolveRuntimePublisherLeaseStatus` provide a small heartbeat model for
app-owned publisher liveness. Store the lease wherever your runtime keeps
publisher process metadata; OLOS only computes expiry and stale status. Pass a
heartbeat callback into publisher upload steps when a publisher must prove it is
still live before OLOS issues a new slot or grant. After a committed or
idempotent step, refresh the lease again so health checks reflect completed
publication work.

`createRuntimePublisherObjectPlan` creates slot payloads and commit IDs for
init, segment, and part objects. Direct-public object plans require an
app-generated `objectKeyNonce` so future object URLs are not deterministic.
`createRuntimePublisherObjectKeyNonce` can format app-supplied entropy bytes
for that field:

```ts
import { createRuntimePublisherObjectKeyNonce } from "olos/runtime";

const objectKeyNonce = createRuntimePublisherObjectKeyNonce({
  bytes: crypto.getRandomValues(new Uint8Array(16)),
});
```

The planner is a naming helper, not a scheduler; the application still controls
encoder timing and retry policy.

`resolveRuntimePublisherNextObjectPosition` derives the next init, segment, or
part position from the current trusted cursor. It does not sleep, poll, upload,
or decide byte limits.
`createRuntimePublisherObjectPlanInput` combines that position with app-owned
per-kind object defaults before a concrete plan is created.

`resolveRuntimePublisherObjectExpiry` derives a short-lived `expiresAt` and
`ttlSeconds` from object duration plus target latency. Use it for planned slot
expiry and provider upload grant TTLs when you want OLOS to keep that policy
consistent without taking over scheduling.
Commit paths reject observations after `expiresAt` by default. Set
`lateToleranceMs` only when a deployment deliberately accepts small clock or
provider-event delays, and apply the same value to live commits, provider
events, publisher helpers, and reconciliation so recovery does not publish a
different stream than the live path would.
`createRuntimePublisherNextObjectPlan` combines cursor cadence, object defaults,
and expiry policy into the next planned object. The application still owns the
publisher loop, encoder timing, upload retries, and commit timing.

`resolveRuntimeLiveHealth` combines cursor freshness and optional publisher
lease status into `active`, `starting`, or `stale`. Use it for dashboards and
watchdogs; the application still owns polling, alerts, and restart policy.

`createRuntimeObjectLowLatencyProfile` returns the current object low-latency
runtime defaults: 0.5s parts, 2s segments, 3s target latency, 3s blocking reload
waits, 3s HLS hold-backs, 1s manifest caching, and a 5s cursor staleness
threshold.
`createRuntimeObjectLowLatencyManifestOptions` maps that profile into manifest
rendering, response cache, and blocking reload options.
`createRuntimeObjectLowLatencyPublisherOptions` maps it into upload expiry and
publisher lease options.
`createRuntimeObjectLowLatencyPublisherDefaults` maps profile timing into
publisher object defaults while the application supplies content type and byte
limits.

### Publication Control

Use `publicationControl` to stop new publication during an incident or budget
limit without tearing down the session:

```ts
import { createStoredCoordinatorRuntimeHandler } from "olos/runtime";
import { createPublicationKillSwitch } from "olos/state";

const handleOlos = createStoredCoordinatorRuntimeHandler({
  allowedMediaOrigins: ["https://media.example.com"],
  blockingReload: {
    timeoutMs: 3000,
    waitForCursor: ({ cursor, signal }) =>
      cursorStore.waitForNext(cursor.sessionId, { signal }),
  },
  publicationControl: createPublicationKillSwitch("incident"),
  store,
});
```

The kill switch blocks slot issuance, upload commits, provider-event handling,
and cursor advancement. Existing manifests continue to render from the last
trusted cursor. The application still owns viewer access revocation, media
prefix blocks, and cache purge.

Use `commitPolicy` when publication depends on app-owned publisher
authorisation or quota state:

```ts
import { createStoredCoordinatorRuntimeHandler } from "olos/runtime";

const handleOlos = createStoredCoordinatorRuntimeHandler({
  allowedMediaOrigins: ["https://media.example.com"],
  commitPolicy: ({ slot }) => {
    if (!publisherAccess.canCommit(slot.publisherInstanceId, slot.sessionId)) {
      return {
        error: {
          code: "olos.security_policy_violation",
          message: "publisher is not authorised",
        },
        status: "rejected",
      };
    }

    if (!tenantQuota.canPublish(slot.tenantId, slot.maxBytes)) {
      return {
        error: {
          code: "olos.quota_exceeded",
          message: "tenant quota exceeded",
        },
        status: "rejected",
      };
    }

    return { status: "allowed" };
  },
  store,
});
```

The hook runs before a new commit is written and is shared by runtime and S3
commit paths. OLOS does not store accounts, roles, billing limits, or quota
counters; the application provides those decisions.

### Store Adapter Helpers

The coordinator store is intentionally small: load a session snapshot and save a
new snapshot with an optional expected ETag. Real adapters can use protocol
helpers to keep persistence format and optimistic concurrency consistent:

```ts
import {
  createNextCoordinatorPipelineEtag,
  parseCoordinatorPipelineSnapshot,
  serializeCoordinatorPipelineSnapshot,
} from "olos/protocol";

const snapshot = parseCoordinatorPipelineSnapshot(row.snapshot_json);
const nextEtag = createNextCoordinatorPipelineEtag(snapshot.etag);
const body = serializeCoordinatorPipelineSnapshot({
  etag: nextEtag,
  state: nextState,
});
```

The adapter owns transactions, indexes, and backend-specific conflict checks.
OLOS owns snapshot cloning, JSON parsing, and ETag sequencing.

For stores that persist an opaque JSON snapshot plus a separate ETag column,
`createSerializedCoordinatorStore` adapts the backend to the coordinator store
contract:

```ts
import { createSerializedCoordinatorStore } from "olos/protocol";

const store = createSerializedCoordinatorStore({
  load: (sessionId) => loadSnapshotRow(sessionId),
  save: (options) => saveSnapshotRowAtomically(options),
});
```

`saveSnapshotRowAtomically` should insert only when `expectedEtag` is absent and
the row does not exist. When `expectedEtag` is present, it should update only if
the current row has that ETag. On conflict, return the current row when the
backend can read it in the same transaction.

Backend adapters should map the serialized contract as:

| Case | Required behavior |
| --- | --- |
| `load(sessionId)` misses | Return `undefined`. |
| `save` without `expectedEtag` and no row exists | Insert `record` and return `saved`. |
| `save` without `expectedEtag` and a row exists | Return `conflict` with the current row when available. |
| `save` with `expectedEtag` and matching row | Replace the row with `record` and return `saved`. |
| `save` with `expectedEtag` and no row or mismatch | Return `conflict` with the current row when available. |

SQL adapters should enforce this with a primary key on `sessionId` and
conditional `INSERT`/`UPDATE ... WHERE etag = ?` statements inside one
transaction. KV-style adapters need an equivalent compare-and-set primitive; a
plain read followed by an unconditional write is not enough for concurrent
publishers.

Use `createMemorySerializedCoordinatorStoreBackend` as a small reference
implementation for tests or adapter development.

For SQLite-compatible databases, `createSqliteSerializedCoordinatorStoreBackend`
expects a table with these columns:

```sql
create table olos_coordinator_snapshots (
  session_id text primary key,
  etag text not null,
  snapshot text not null
);
```

The adapter uses conditional inserts and `update ... where etag = ?`, so the
database must report changed row counts from `run()`.

For production adapter guidance, see the repository
[store adapters guide](https://github.com/arsenstorm/olos/blob/main/contributing/core/store-adapters.md).

## Stored S3 Serving Flow

`olos/s3` can bind S3 object uploads to coordinator state and return HLS
manifest responses after a commit.

```ts
import { resolveHlsManifestArtifactResponse } from "olos/hls";
import {
  commitStoredS3CoordinatorUpload,
  issueStoredS3CoordinatorUploadGrant,
  normalizeS3ObjectCreatedEvents,
  routeStoredS3CoordinatorUploadEvent,
} from "olos/s3";

const issued = await issueStoredS3CoordinatorUploadGrant({
  bucket: "media",
  client: s3,
  contentType: "video/mp4",
  deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
  duration: 2,
  expiresAt: "2026-01-01T00:00:05.000Z",
  expiresInSeconds: 3,
  kind: "segment",
  maxBytes: 100_000,
  mediaSequenceNumber: 3810,
  objectKey: "media/v1080/3810.m4s",
  publicationMode: "direct-public",
  publisherInstanceId: "publisher_1",
  renditionId: "v1080",
  sessionId: "session_1",
  slotId: "slot_3810",
  store,
});

if (issued.status !== "saved") {
  throw new Error("upload grant was not issued");
}
```

Upload clients must send every header returned in `issued.grant.requiredHeaders`.
S3 grants include `x-amz-meta-olos-slot-id`, which lets later `HeadObject`
observations normalize the stored metadata back to the protocol-level
`x-olos-slot-id`. If an application supplies its own presigned URL, it must
allow that metadata header.

```ts
const committed = await commitStoredS3CoordinatorUpload({
  bucket: "media",
  client: s3,
  commitId: "commit_3810",
  committedAt: new Date().toISOString(),
  independent: true,
  manifest: {
    allowedMediaOrigins: ["https://media.example.com"],
    partTarget: 0.5,
    segmentTarget: 2,
    targetLatency: 3,
  },
  providerId: "s3_primary",
  sessionId: issued.slot.sessionId,
  slotId: issued.slot.slotId,
  store,
});

if (
  (committed.status === "committed" || committed.status === "idempotent") &&
  committed.manifest
) {
  const response = resolveHlsManifestArtifactResponse(
    committed.manifest.artifacts,
    "/v1/live/session_1/v1080/media.m3u8"
  );
}
```

For applications that want a Fetch-compatible route handler, `olos/s3` exposes
the same flow over HTTP without choosing a web framework:

```ts
import { createStoredS3CoordinatorRuntimeHandler } from "olos/s3";

const handleOlos = createStoredS3CoordinatorRuntimeHandler({
  allowedMediaOrigins: ["https://media.example.com"],
  bucket: "media",
  client: s3,
  expiresInSeconds: 3,
  providerId: "s3_primary",
  store,
});

export default {
  fetch(request: Request) {
    return handleOlos(request);
  },
};
```

The S3 runtime handler delegates the stored runtime routes and adds:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/sessions/:id/s3/slots` | Issue a stored upload slot and return an S3 upload grant. |
| `POST` | `/sessions/:id/s3/commits` | Observe the uploaded S3 object, commit it, and return commit/cursor data. |
| `POST` | `/sessions/:id/s3/events` | Normalize S3 object-created records and route them through coordinator commits. |
| `POST` | `/sessions/:id/s3/reconcile-plan` | List in-flight S3 slots that can be passed to recovery. |
| `POST` | `/sessions/:id/s3/reconcile` | Retry S3-backed commits for issued slots after missed events or process restarts. |
| `POST` | `/sessions/:id/s3/retention` | Plan retention and delete retired media objects through S3. |

For typed route consumers, `olos/s3` exports
`StoredS3CoordinatorSlotGrantResponse`, `StoredS3CoordinatorCommitResponse`,
`StoredS3CoordinatorEventRouteResponse`,
`StoredS3CoordinatorReconciliationResponse`, and
`StoredS3CoordinatorRetentionResponse`.

The generic runtime routes remain available through the same handler, including
`POST /sessions`, `POST /sessions/:id/slots`, `POST /sessions/:id/commits`,
`POST /sessions/:id/transition`, `POST /sessions/:id/heartbeat`,
`GET /sessions/:id/health`, `GET /sessions/:id/retention`, and
`GET /v1/live/:id/...`.

After an S3-backed commit advances the trusted cursor, the same handler serves
the corresponding HLS manifests from `GET /v1/live/:id/...`.

S3 `ObjectCreated:*` event payloads can also be routed through the same stored
coordinator flow:

```ts
const [event] = normalizeS3ObjectCreatedEvents({
  contentType: "video/mp4",
  payload: s3EventPayload,
  providerId: "s3_primary",
});

if (event?.status !== "object_created") {
  throw new Error("S3 object-created event was invalid");
}

await routeStoredS3CoordinatorUploadEvent({
  bucket: "media",
  client: s3,
  event,
  manifest: {
    allowedMediaOrigins: ["https://media.example.com"],
    partTarget: 0.5,
    segmentTarget: 2,
    targetLatency: 3,
  },
  providerId: "s3_primary",
  sessionId: "session_1",
  store,
});
```

The application owns authentication, handler mounting, the coordinator store,
and S3 client configuration. OLOS owns the upload-slot rules, S3 object
observation, cursor update, manifest rendering, and response metadata.

Publisher processes can use `runStoredS3PublisherUploadStep` to compose one
object publication step: optionally refresh publisher heartbeat, issue a grant,
let the app PUT to the granted URL, then commit the slot through S3 object
observation.

For planned init, segment, and part objects,
`runPlannedStoredS3PublisherUploadStep` also derives the object key, slot ID,
commit ID, slot expiry, and grant TTL before running that same step. It handles
one object at a time; the application still owns encoder timing and retries.
`runNextStoredS3PublisherUploadStep` can derive that plan from the current
cursor window plus publisher defaults.
Use `resolveRuntimePublisherLoopDecision` around these step results for
app-owned retry loops; retrying a failed PUT after a grant is issued should stay
inside the application's upload callback.
Publisher loops should refresh their app-owned lease after a successful
`continue` decision, then wait on their own encoder/cadence signal before asking
OLOS for the next object. This post-success refresh is separate from the
optional pre-grant heartbeat gate on the upload step.
Use `summarizeStoredS3PublisherUploadStep` for stable log fields from each
publisher step without coupling application telemetry to OLOS internals.

Recovery jobs can use `planStoredS3CoordinatorReconciliation` to list in-flight
S3 slots, then pass selected IDs into `reconcileStoredS3CoordinatorUploads` to
retry commits after missed provider events or process restarts. The application
decides when to run recovery and how many slots to target.
Use `summarizeStoredS3CoordinatorUploadReconciliation` to count committed,
idempotent, and failed recovery results. The summary includes failed slot IDs
and OLOS error codes for rejected recovery commits.

Retention jobs can pass retired objects from `planStoredCoordinatorRetention`
to `deleteRetiredS3CoordinatorObjects` to delete old media objects through S3.
Use `summarizeRetiredCoordinatorObjectDeletions` to count deleted and failed
objects and retain failed object keys and slot IDs for retry logs.
The S3 runtime handler exposes the same deletion path at
`POST /sessions/:id/s3/retention`. The body requires `now` so the retention
cutoff is explicit.

The S3 runtime handler exposes the same recovery path at
`POST /sessions/:id/s3/reconcile`. The body requires `committedAt`; `providerId`
can be supplied in the body or configured on the handler. The response includes
per-slot `results` and a `summary` for log or metric sinks.
If the live path uses `lateToleranceMs`, pass that value to the handler or
include it in the commit and reconciliation bodies so S3 events, completion
hints, and recovery share the same slot-expiry policy.
Use `POST /sessions/:id/s3/reconcile-plan` with optional `slotIds` to inspect
candidate slots before running recovery.

For a concise production wiring guide, see the repository
[production object pipeline](https://github.com/arsenstorm/olos/blob/main/contributing/core/production-pipeline.md).

### Direct-Public Security

`direct-public` means uploaded media objects may be readable from storage before
they appear in a trusted manifest. Use it only when object keys are unguessable
or short-lived exposure is acceptable.

OLOS can validate provider capability documents, issue exact-key upload grants,
commit only observed objects that match issued slots, keep manifests gated by
the trusted cursor, and derive cache policies for manifests, media objects, and
negative object responses. `createDirectPublicSecurityPolicy` returns the
media-only response header policy, forbidden response headers, and supported
media extensions that a CDN or media gateway should enforce.
Use `createDirectPublicMediaResponseHeaders` to compose committed-media
`Content-Type`, immutable `Cache-Control`, `nosniff`, and cross-origin headers
before serving media objects from a direct-public origin.
Use `createDirectPublicNegativeObjectResponseHeaders` for missing or future
media-object responses so 404s use the declared short negative cache policy.
Use
`resolveDirectPublicMediaRequestPolicy` to reject unknown extensions, document
navigations, and HTML `Accept` requests before serving direct-public media.

Object keys are treated as storage identity, not URLs. Validators and runtime
request parsers reject traversal segments, absolute-style paths, control
characters, query strings, and fragments for object keys. Delivery URLs must be
root-relative or absolute HTTP(S) URLs and must not carry query strings,
fragments, or control characters. Completion hints may include an object key,
but never a publisher-supplied media URL; committed delivery URLs are derived
from the issued slot and provider/coordinator state.

The application and storage layer still own bucket policy, CDN rules, viewer
authorization, object-key secrecy, cache purge, and emergency prefix blocks. If
media must never be public before commit, use a read-gated or private-upload
promotion flow instead of direct-public publication.

#### No-Scan Mode

OLOS does not inspect uploaded media bytes. It validates publication rights,
object identity, slot sequence, object size, immutability, and delivery context;
it does not prove that media is safe, legal, well-formed, decodable, or free
from malware.

For deployment controls, see the repository
[direct-public checklist](https://github.com/arsenstorm/olos/blob/main/contributing/core/direct-public-deployment.md).

## Retention Planning

`olos/state` can select cleanup candidates without deleting app-owned data:

```ts
import {
  selectExpiredUploadSlots,
  selectRetiredCommittedObjects,
} from "olos/state";
import { planCoordinatorRetention } from "olos/protocol";

const expiredSlots = selectExpiredUploadSlots({ now, slots });
const retiredObjects = selectRetiredCommittedObjects({
  commits,
  retainedWindow: cursor.committedWindow,
});
const plan = planCoordinatorRetention({ now, state });
```

`olos/runtime` can execute retired-object deletion through an app-owned callback:

```ts
import {
  deleteRetiredCoordinatorObjects,
  summarizeRetiredCoordinatorObjectDeletions,
} from "olos/runtime";

const result = await deleteRetiredCoordinatorObjects({
  deleteObject: (object) => objectStore.delete(object.objectKey),
  objects: plan.retiredObjects,
});
const summary = summarizeRetiredCoordinatorObjectDeletions(result);
```

The application still owns object storage credentials, slot persistence, and
retry policy.

## HLS Blocking Reload

`olos/hls` can decide whether an LL-HLS media playlist request should return
the current playlist immediately or block until the trusted cursor advances.

```ts
import {
  createHlsManifestErrorWebResponse,
  createHlsManifestWebResponse,
  parseHlsBlockingReloadRequest,
  resolveBlockingHlsManifestArtifactResponse,
  resolveHlsBlockingReload,
  waitForHlsBlockingReload,
} from "olos/hls";

const request = parseHlsBlockingReloadRequest(
  "/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3812&_HLS_part=2"
);
const reload = resolveHlsBlockingReload(cursor, request);

if (reload.status === "block") {
  // Wait on the application-owned cursor store, then render again.
}
```

For the common gateway case, pass the application-owned cursor watcher into
`waitForHlsBlockingReload`:

```ts
const result = await waitForHlsBlockingReload({
  cursor,
  request,
  timeoutMs: 3000,
  waitForCursor: ({ signal }) => cursorStore.waitForNext(sessionId, { signal }),
});
```

OLOS owns the blocking decision and timeout boundary. The application owns the
cursor store and wake-up mechanism.

Gateways can resolve a complete manifest response through the same boundary:

```ts
const response = await resolveBlockingHlsManifestArtifactResponse({
  cursor,
  manifest: {
    allowedMediaOrigins: ["https://media.example.com"],
    partTarget: cursor.partTarget,
    segmentTarget: cursor.segmentTarget,
  },
  requestUrl: request.url,
  session,
  timeoutMs: 3000,
  waitForCursor: ({ signal }) => cursorStore.waitForNext(sessionId, { signal }),
});

if (response.status === "ready" || response.status === "timeout") {
  return createHlsManifestWebResponse(response.response);
}

return createHlsManifestErrorWebResponse(response);
```

## Upload Event Identity

`olos/s3` accepts normalized upload events through
`routeStoredS3CoordinatorUploadEvent`.

For `object.created` events, the event ID becomes the commit ID, the object
observation time becomes `committedAt`, and the object key is matched against an
issued upload slot before S3 is queried.

For `upload.completed` hints, the hint ID becomes the commit ID, the hint time
becomes `committedAt`, and both the slot ID and object key must match before the
upload can be committed.

Provider-event commits still run through `commitPolicy`; storage events are not
publication authority by themselves.

This keeps retries idempotent: replaying the same provider event reaches the
same commit identity instead of creating a new media commit.

## Release Check

Before publishing, run the package gate from the repository root:

```bash
bun --filter olos publish:check
```

The gate verifies the changelog, release notes, type checks, Bun tests, E2E
tests, build output, export-map dry packing, and package smoke import/type
checks.
