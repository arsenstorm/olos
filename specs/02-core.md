# OLOS Core Protocol

Status: `draft-v0.1.2`

## 1. Abstract

OLOS Core defines the provider-neutral control model for live object streaming.

It defines:

```text
sessions
publishers
upload slots
media objects
commits
cursors
epochs
discontinuities
pathways
errors
```

OLOS Core does not define a storage API or playback syntax. Those are defined by bindings and mappings.

## 2. Identifiers

An OLOS implementation MUST define stable identifiers for:

```text
tenant_id
session_id
publisher_id
publisher_instance_id
epoch
rendition_id
track_id
switching_set_id
media_sequence_number
part_number
slot_id
provider_id
pathway_id
```

Identifiers exposed in URLs SHOULD be opaque and URL-safe.

`media_sequence_number` and `part_number` MUST be non-negative integers.

`epoch` MUST increase when object-key reuse, restart ambiguity, or timeline discontinuity would otherwise make the live timeline unsafe.

## 3. Session

A session represents one live stream lifecycle.

### 3.1 Session states

```text
created
starting
live
ending
ended
aborted
expired
```

State transitions:

```text
created -> starting -> live -> ending -> ended
created -> aborted
starting -> aborted
live -> aborted
live -> expired
```

### 3.2 Session object

```json
{
  "olos": "1.0",
  "sessionId": "sess_01JZLIVE",
  "tenantId": "tenant_acme",
  "state": "live",
  "createdAt": "2026-06-08T12:00:00Z",
  "epoch": 1,
  "latencyProfile": "object-ll",
  "partTarget": 0.5,
  "segmentTarget": 2.0,
  "renditions": [
    {
      "renditionId": "v1080",
      "kind": "video",
      "codec": "avc1.640028",
      "width": 1920,
      "height": 1080,
      "frameRate": 30,
      "bitrate": 5000000
    },
    {
      "renditionId": "a128",
      "kind": "audio",
      "codec": "mp4a.40.2",
      "sampleRate": 48000,
      "channels": 2,
      "bitrate": 128000
    }
  ]
}
```

## 4. Publisher

A publisher is an authenticated process authorised to fill upload slots for a session.

A coordinator MUST bind each upload slot to a publisher or publisher instance.

A publisher MUST NOT be allowed to:

```text
modify the authoritative cursor directly
upload canonical playlists
choose arbitrary public media URLs
choose arbitrary object keys
advance media sequence numbers without coordinator-issued slots
```

## 5. UploadSlot

An upload slot is a pre-authorised location in the live timeline.

### 5.1 UploadSlot states

```text
issued
upload_observed
committed
announced
expired
rejected
revoked
```

Allowed transitions:

```text
issued -> upload_observed -> committed -> announced
issued -> expired
issued -> revoked
upload_observed -> rejected
upload_observed -> revoked
committed -> revoked, only before announcement
```

`revoked` means the slot MUST NOT be emitted in newly generated official playback state.

A committed-but-not-announced slot MAY be revoked and replaced by a newly issued slot with a different `slot_id` and different `objectKey` for the same timeline position.

An announced slot MUST NOT be silently revoked or replaced. Once a slot has been announced in an official manifest, the coordinator MUST treat the announced media object as immutable historical stream state until it naturally ages out of the live window. If the object must be withdrawn for safety, legal or abuse reasons, the coordinator MUST take one of the following actions:

```text
freeze playlist advancement at the last safe position
abort the session
start a new epoch or discontinuity after the last safe position
disable or read-gate the affected delivery pathway
```

The coordinator MUST NOT overwrite the announced object key and MUST NOT emit a different media object for the same announced `{epoch, rendition_id, media_sequence_number, part_number}` position.

### 5.2 UploadSlot object

```json
{
  "slotId": "slot_01JZ",
  "sessionId": "sess_01JZLIVE",
  "tenantId": "tenant_acme",
  "publisherInstanceId": "pubinst_01",
  "epoch": 1,
  "renditionId": "v1080",
  "mediaSequenceNumber": 3812,
  "partNumber": 3,
  "kind": "part",
  "duration": 0.5,
  "objectKey": "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p3-slot_01JZ.m4s",
  "deliveryUrl": "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p3-slot_01JZ.m4s",
  "publicationMode": "direct-public",
  "contentType": "video/mp4",
  "minBytes": 1024,
  "maxBytes": 524288,
  "expiresAt": "2026-06-08T12:00:05Z",
  "state": "issued"
}
```

### 5.3 UploadSlot requirements

A coordinator:

```text
MUST issue slots before upload
MUST bind each slot to exactly one session, epoch, rendition, media sequence number and part number
MUST define an exact object key
MUST define an exact content type
MUST define maximum object size
SHOULD define minimum object size
MUST define an expiry time
MUST reject uploads observed outside the issued slot constraints
```

## 6. UploadGrant

An upload grant tells a publisher how to fill a slot.

Example:

```json
{
  "slotId": "slot_01JZ",
  "method": "PUT",
  "url": "https://storage-provider.example/upload?...signature...",
  "expiresAt": "2026-06-08T12:00:05Z",
  "requiredHeaders": {
    "Content-Type": "video/mp4",
    "If-None-Match": "*",
    "x-olos-slot-id": "slot_01JZ"
  }
}
```

Upload grants are bearer capabilities. A coordinator SHOULD make them short-lived.

## 7. MediaObject

A media object is a completed immutable object that may be committed.

Object kinds:

```text
init
part
segment
sidecar
```

v0.1.2 requires `init`, `part`, and optionally `segment`.

MediaObject metadata:

```json
{
  "providerId": "r2-primary",
  "objectKey": "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p3-slot_01JZ.m4s",
  "contentType": "video/mp4",
  "size": 312500,
  "etag": "\"9b2cf535f27731c974343645a3985328\"",
  "observedAt": "2026-06-08T12:00:01.750Z"
}
```

## 8. Commit

A commit is the coordinator’s decision that a media object fills an upload slot.

The publisher may provide a completion hint, but the coordinator MUST verify object existence or receive a trusted provider event before committing.

### 8.1 Commit object

```json
{
  "commitId": "commit_01JZ",
  "slotId": "slot_01JZ",
  "sessionId": "sess_01JZLIVE",
  "epoch": 1,
  "renditionId": "v1080",
  "mediaSequenceNumber": 3812,
  "partNumber": 3,
  "providerId": "r2-primary",
  "objectKey": "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p3-slot_01JZ.m4s",
  "deliveryUrl": "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p3-slot_01JZ.m4s",
  "publicationMode": "direct-public",
  "duration": 0.5,
  "independent": false,
  "programDateTime": "2026-06-08T12:00:01.500Z",
  "size": 312500,
  "etag": "\"9b2cf535f27731c974343645a3985328\"",
  "committedAt": "2026-06-08T12:00:01.820Z"
}
```

### 8.2 Commit requirements

A coordinator:

```text
MUST treat commits as idempotent
MUST reject commits for unknown slots
MUST reject commits whose object key does not match the slot
MUST reject commits whose object size exceeds the slot maximum
MUST reject non-identical duplicate commits for the same slot
MUST NOT commit an object before it is known to be readable
MUST NOT advance the cursor past an uncommitted required object unless a discontinuity or gap policy is invoked
```

## 9. Cursor

The cursor is the authoritative live edge for a session.

The cursor is the only source of truth used by manifest gateways.

### 9.1 Cursor object

```json
{
  "olos": "1.0",
  "sessionId": "sess_01JZLIVE",
  "tenantId": "tenant_acme",
  "epoch": 1,
  "state": "live",
  "latencyProfile": "object-ll",
  "partTarget": 0.5,
  "segmentTarget": 2.0,
  "window": {
    "firstMediaSequenceNumber": 3810,
    "lastMediaSequenceNumber": 3812,
    "lastPartNumber": 3
  },
  "committedWindow": {
    "epoch": 1,
    "discontinuitySequence": 0,
    "firstMediaSequenceNumber": 3810,
    "lastMediaSequenceNumber": 3812,
    "renditions": {
      "v1080": {
        "renditionId": "v1080",
        "init": {
          "slotId": "slot_init_v1080",
          "commitId": "commit_init_v1080",
          "objectKey": "media/tenant_acme/sess_01JZLIVE/e1/v1080/init-slot_init_v1080.mp4",
          "deliveryUrl": "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/init-slot_init_v1080.mp4",
          "contentType": "video/mp4",
          "etag": "\"init-etag\""
        },
        "segments": [
          {
            "mediaSequenceNumber": 3810,
            "duration": 2.0,
            "programDateTime": "2026-06-08T12:00:00.000Z",
            "independent": true,
            "discontinuityBefore": false,
            "segment": {
              "slotId": "slot_s3810",
              "commitId": "commit_s3810",
              "objectKey": "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3810/segment-slot_s3810.m4s",
              "deliveryUrl": "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3810/segment-slot_s3810.m4s",
              "duration": 2.0,
              "etag": "\"seg3810-etag\""
            },
            "parts": []
          },
          {
            "mediaSequenceNumber": 3811,
            "duration": 2.0,
            "programDateTime": "2026-06-08T12:00:02.000Z",
            "independent": true,
            "discontinuityBefore": false,
            "segment": {
              "slotId": "slot_s3811",
              "commitId": "commit_s3811",
              "objectKey": "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3811/segment-slot_s3811.m4s",
              "deliveryUrl": "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3811/segment-slot_s3811.m4s",
              "duration": 2.0,
              "etag": "\"seg3811-etag\""
            },
            "parts": []
          },
          {
            "mediaSequenceNumber": 3812,
            "duration": 2.0,
            "programDateTime": "2026-06-08T12:00:04.000Z",
            "independent": true,
            "discontinuityBefore": false,
            "parts": [
              {
                "slotId": "slot_3812_0",
                "commitId": "commit_3812_0",
                "partNumber": 0,
                "duration": 0.5,
                "independent": true,
                "programDateTime": "2026-06-08T12:00:04.000Z",
                "objectKey": "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p0-slot_3812_0.m4s",
                "deliveryUrl": "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p0-slot_3812_0.m4s",
                "etag": "\"p0-etag\""
              },
              {
                "slotId": "slot_3812_1",
                "commitId": "commit_3812_1",
                "partNumber": 1,
                "duration": 0.5,
                "independent": false,
                "programDateTime": "2026-06-08T12:00:04.500Z",
                "objectKey": "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p1-slot_3812_1.m4s",
                "deliveryUrl": "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p1-slot_3812_1.m4s",
                "etag": "\"p1-etag\""
              },
              {
                "slotId": "slot_3812_2",
                "commitId": "commit_3812_2",
                "partNumber": 2,
                "duration": 0.5,
                "independent": false,
                "programDateTime": "2026-06-08T12:00:05.000Z",
                "objectKey": "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p2-slot_3812_2.m4s",
                "deliveryUrl": "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p2-slot_3812_2.m4s",
                "etag": "\"p2-etag\""
              },
              {
                "slotId": "slot_3812_3",
                "commitId": "commit_3812_3",
                "partNumber": 3,
                "duration": 0.5,
                "independent": false,
                "programDateTime": "2026-06-08T12:00:05.500Z",
                "objectKey": "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p3-slot_3812_3.m4s",
                "deliveryUrl": "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p3-slot_3812_3.m4s",
                "etag": "\"p3-etag\""
              }
            ]
          }
        ]
      }
    }
  },
  "pathways": [
    {
      "pathwayId": "r2-primary",
      "providerId": "r2-primary",
      "priority": 1,
      "baseUrl": "https://media.example.com",
      "state": "active"
    }
  ],
  "updatedAt": "2026-06-08T12:00:05.820Z"
}
```

### 9.2 CommittedWindow

`CommittedWindow` is the normative committed media window consumed by playback mappings.

A cursor MUST expose a committed window directly or through a stable cursor-linked resource before a manifest gateway can render official playback state.

A `CommittedWindow` MUST include:

```text
epoch
discontinuitySequence
firstMediaSequenceNumber
lastMediaSequenceNumber
one or more rendition windows
committed init object metadata for each rendition
committed segment entries inside the live window
committed part entries for the live-edge segment when using low-latency playback
```

A rendition window contains ordered segment entries. Each segment entry MAY contain a full segment object, partial objects, or both, depending on packaging mode and how far that segment has progressed.

A part or segment entry MUST include:

```text
slotId
commitId
mediaSequenceNumber, directly or by containing segment
partNumber, for parts
duration
deliveryUrl
objectKey
independent flag, where known
programDateTime, where known
discontinuityBefore, on the segment where applicable
```

A manifest gateway MUST render only entries present in the committed window. It MUST NOT infer playable media by listing storage objects or by trusting publisher-supplied positions.

### 9.3 Cursor requirements

A coordinator:

```text
MUST maintain one authoritative cursor per active session
MUST advance cursor positions monotonically within an epoch
MUST create a new epoch or discontinuity for unsafe timeline resets
MUST NOT allow publishers to write cursor state directly
MUST expose a `CommittedWindow` sufficient for deterministic manifest generation
```

## 10. Epochs and discontinuities

An epoch separates incompatible object-key or timeline regions.

A discontinuity represents a playback timeline break.

A coordinator MUST introduce an epoch or discontinuity when:

```text
media sequence numbers reset
timestamps jump outside tolerance
rendition track layout changes incompatibly
a publisher reconnect creates ambiguous object identity
a committed object sequence cannot be safely continued
```

## 11. Pathways

A pathway is a storage/delivery route for committed media.

Example:

```json
{
  "pathwayId": "r2-primary",
  "providerId": "r2-primary",
  "priority": 1,
  "baseUrl": "https://media.example.com",
  "state": "active"
}
```

Pathway states:

```text
active
degraded
draining
disabled
```

## 12. HTTP API

OLOS Core defines the following logical API. Bindings may adapt transport details.
The package runtime helpers expose lower-level coordinator routes that accept
already constructed OLOS protocol objects.

```http
POST /olos/v1/sessions
GET  /olos/v1/sessions/{session_id}
POST /olos/v1/sessions/{session_id}/upload-slots
POST /olos/v1/sessions/{session_id}/upload-slots/{slot_id}/complete
GET  /olos/v1/sessions/{session_id}/cursor
POST /olos/v1/sessions/{session_id}/end
POST /olos/v1/sessions/{session_id}/abort
GET  /.well-known/olos-provider
```

### 12.1 Create session

Request:

```json
{
  "session": {
    "olos": "1.0",
    "sessionId": "sess_01JZLIVE",
    "tenantId": "tenant_acme",
    "state": "created",
    "createdAt": "2026-06-08T12:00:00Z",
    "epoch": 1,
    "latencyProfile": "object-ll",
    "partTarget": 0.5,
    "segmentTarget": 2.0,
    "renditions": [
      {
        "renditionId": "v1080",
        "kind": "video",
        "codec": "avc1.640028",
        "width": 1920,
        "height": 1080,
        "frameRate": 30,
        "bitrate": 5000000
      }
    ]
  },
  "pathways": [
    {
      "pathwayId": "primary",
      "providerId": "s3-primary",
      "priority": 0,
      "baseUrl": "https://media.example.com",
      "state": "active"
    }
  ]
}
```

Response:

```json
{
  "sessionId": "sess_01JZLIVE"
}
```

### 12.2 Request upload slot

Request:

```json
{
  "slotId": "slot_01JZ",
  "publisherInstanceId": "pubinst_01",
  "renditionId": "v1080",
  "kind": "part",
  "mediaSequenceNumber": 3812,
  "partNumber": 3,
  "duration": 0.5,
  "objectKey": "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p3-slot_01JZ.m4s",
  "deliveryUrl": "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p3-slot_01JZ.m4s",
  "publicationMode": "direct-public",
  "contentType": "video/mp4",
  "minBytes": 1024,
  "maxBytes": 524288,
  "expiresAt": "2026-06-08T12:00:05Z"
}
```

Response:

```json
{
  "slot": {
    "slotId": "slot_01JZ",
    "sessionId": "sess_01JZLIVE",
    "tenantId": "tenant_acme",
    "publisherInstanceId": "pubinst_01",
    "epoch": 1,
    "renditionId": "v1080",
    "mediaSequenceNumber": 3812,
    "partNumber": 3,
    "kind": "part",
    "duration": 0.5,
    "objectKey": "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p3-slot_01JZ.m4s",
    "deliveryUrl": "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p3-slot_01JZ.m4s",
    "publicationMode": "direct-public",
    "contentType": "video/mp4",
    "minBytes": 1024,
    "maxBytes": 524288,
    "expiresAt": "2026-06-08T12:00:05Z",
    "state": "issued"
  }
}
```

### 12.3 Commit upload

The coordinator commits only after object metadata has been observed through a
trusted provider path or an application-owned verification step.

Request:

```json
{
  "slotId": "slot_01JZ",
  "commitId": "commit_01JZ",
  "committedAt": "2026-06-08T12:00:01.820Z",
  "programDateTime": "2026-06-08T12:00:01.500Z",
  "object": {
    "providerId": "s3-primary",
    "objectKey": "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p3-slot_01JZ.m4s",
    "contentType": "video/mp4",
    "size": 312500,
    "etag": "\"9b2cf535f27731c974343645a3985328\"",
    "observedAt": "2026-06-08T12:00:01.750Z"
  }
}
```

Response:

```json
{
  "commit": {
    "commitId": "commit_01JZ",
    "slotId": "slot_01JZ",
    "sessionId": "sess_01JZLIVE",
    "epoch": 1,
    "renditionId": "v1080",
    "mediaSequenceNumber": 3812,
    "partNumber": 3,
    "providerId": "s3-primary",
    "objectKey": "media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p3-slot_01JZ.m4s",
    "deliveryUrl": "https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p3-slot_01JZ.m4s",
    "publicationMode": "direct-public",
    "duration": 0.5,
    "programDateTime": "2026-06-08T12:00:01.500Z",
    "size": 312500,
    "etag": "\"9b2cf535f27731c974343645a3985328\"",
    "committedAt": "2026-06-08T12:00:01.820Z"
  }
}
```

## 13. Error model

OLOS errors SHOULD use stable machine-readable codes.

Examples:

```text
olos.invalid_session
olos.invalid_state
olos.unknown_slot
olos.slot_expired
olos.key_mismatch
olos.object_too_large
olos.duplicate_commit_conflict
olos.cursor_regression
olos.provider_unavailable
olos.quota_exceeded
olos.security_policy_violation
```

Error response:

```json
{
  "error": {
    "code": "olos.object_too_large",
    "message": "Uploaded object exceeds the maximum size for this slot.",
    "details": {
      "slotId": "slot_01JZ",
      "maxBytes": 524288,
      "observedBytes": 10485760
    }
  }
}
```

## 14. Required v0.1.2 build items

```text
core type model
JSON schemas
session state machine
upload slot state machine
commit idempotency
cursor advancement
CommittedWindow model
pathway model
HTTP request/response types
pure security validators
error codes
```
