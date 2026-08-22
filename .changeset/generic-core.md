---
"@arsenstorm/olos": minor
---

Make Core media-agnostic and move the CMAF/LL-HLS vocabulary into the new `@arsenstorm/olos/media` subpath. Breaking for every consumer of the wire format and the TypeScript API:

- Renames: `renditions` → `tracks`, `renditionId` → `trackId`, `mediaSequenceNumber` → `sequenceNumber` (also `first`/`last`/`start` prefixes), `mediaBaseUrl` → `deliveryBaseUrl`, `allowedMediaOrigins` → `allowedDeliveryOrigins`, `MediaObject` → `StorageObject`, `MEDIA_OBJECT_KINDS`/`MediaObjectKind` → `OBJECT_KINDS`/`ObjectKind`, and the S3 metadata header to `x-amz-meta-olos-sequence-number`.
- Sessions carry `profile: { id, ... }` (required) instead of `latencyProfile`/`segmentTarget`/`partTarget`/`discontinuitySequence`; cursors copy it. For LL-HLS use `{ id: "cmaf-llhls", segmentTarget, partTarget }`.
- Tracks carry `profile: { kind, codec, bitrate, width, height, frameRate, channels, sampleRate, groupId, name, defaultTrack }` instead of those fields at the top level. `TRACK_KINDS`, `LATENCY_PROFILES`, and the `Rendition*` types are gone (`MEDIA_TRACK_KINDS` lives in `/media`).
- Slot-issue requests take `profile: { duration }` instead of `duration`; commit requests take `profile: { independent, programDateTime }` instead of those fields. Slots, commits, and committed objects expose an opaque `profile`; the committed profile is the commit's profile merged over the slot's. `discontinuityBefore` moves into the segment's profile and `discontinuitySequence` into the track window's profile.
- Core no longer requires an init commit per track (HLS rendering still does), no longer applies the `.mp4`/`.m4s` extension rule (pass `extension` explicitly; the media publisher defaults do), and derives object keys under the `objects/` prefix by default.
- Publisher pacing helpers (`createRuntimeObjectLowLatencyProfile`, `createRuntimeObjectLowLatencyPublisherDefaults`, `createRuntimeObjectLowLatencyManifestOptions`, `DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE`, ...) move from `@arsenstorm/olos/runtime` to `@arsenstorm/olos/media`. Publisher object defaults use `cadenceSeconds` plus an opaque `profile` instead of `duration`; `runPlannedStoredS3PublisherUploadStep` takes `cadenceSeconds` at the top level.
- `@arsenstorm/olos/media` exports the `MediaSession`/`MediaTrack`/`MediaCursor` narrowings, `assertMediaSession`/`assertMediaCursor`/`assertMediaObjectProfile`, `mediaObjectProfile`/`mediaSegmentDuration`, the `OLOS_MEDIA_*_SCHEMA` JSON Schemas, and the media object-key extension helpers.

Fixes landed with the generic core: store-conflict retries no longer
re-clone a consumed `Request` (parse once, 500 → retry); `maxBodyBytes`
is honoured on every slot/commit/S3 route with 413 for oversized bodies
and a 1000-record cap on `s3/events`; a custom `livePath` now serves
playlists; the in-memory cursor notifier no longer drops newer waiters
after a resolved wait aborts; commit lateness is judged against the
slot's own track edge so trailing tracks can catch up; key mismatch,
late observation, and commits against revoked/expired slots return
`olos.key_mismatch` / `olos.slot_expired` / `olos.invalid_state`
rejections instead of throwing; issuing a second open slot at one
position throws at issuance. The direct-public policy and byterange
responses take profile-supplied `allowedObjectExtensions` /
`objectContentType` / `contentType` (use
`createDirectPublicMediaSecurityPolicy` from `/media` for CMAF);
`mediaCommitPolicy` (the runtime default) requires `profile.duration`
on segment and part commits; runtime defaults no longer import media
pacing.
