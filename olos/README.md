# OLOS

Open Live Object Streaming protocol primitives.

## Imports

```ts
import { OLOS_PROTOCOL_NAME } from "olos";
import type { Session } from "olos/types";
```

## Stored Runtime Pipeline

`olos/runtime` provides provider-neutral helpers for HTTP services that keep
coordinator state in an application-owned store.

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

The application owns the coordinator store, HTTP routing, and S3 client
configuration. OLOS owns the upload-slot rules, S3 object observation, cursor
update, manifest rendering, and response metadata.

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

The application owns object deletion, slot persistence, and retry policy.

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

This keeps retries idempotent: replaying the same provider event reaches the
same commit identity instead of creating a new media commit.
