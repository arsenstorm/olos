# OLOS

Open Live Object Streaming protocol primitives.

## Imports

```ts
import { OLOS_PROTOCOL_NAME } from "olos";
import type { Session } from "olos/types";
```

## Stored S3 Serving Flow

`olos/s3` can bind S3 object uploads to coordinator state and return HLS
manifest responses after a commit.

```ts
import { resolveHlsManifestArtifactResponse } from "olos/hls";
import {
  commitStoredS3CoordinatorUpload,
  issueStoredS3CoordinatorUploadGrant,
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

The application owns the coordinator store, HTTP routing, and S3 client
configuration. OLOS owns the upload-slot rules, S3 object observation, cursor
update, manifest rendering, and response metadata.

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
