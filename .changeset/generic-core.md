---
"@arsenstorm/olos": minor
---

Make Core media-agnostic and move the CMAF/LL-HLS vocabulary into the new `@arsenstorm/olos/media` subpath. Breaking for every consumer of the wire format and the TypeScript API:

- Renames: `renditions` → `tracks`, `renditionId` → `trackId`, `mediaSequenceNumber` → `sequenceNumber` (also `first`/`last`/`start` prefixes), `mediaBaseUrl` → `deliveryBaseUrl`, `allowedMediaOrigins` → `allowedDeliveryOrigins`, `MediaObject` → `StorageObject`, `MEDIA_OBJECT_KINDS`/`MediaObjectKind` → `OBJECT_KINDS`/`ObjectKind`, and the S3 metadata header to `x-amz-meta-olos-sequence-number`. `ProviderCapabilityDocument.consistency.headAfterCreate` → `observeAfterCreate`.
- Sessions carry `profile: { id, ... }` (required) instead of `latencyProfile`/`segmentTarget`/`partTarget`/`discontinuitySequence`; cursors copy it. For LL-HLS use `{ id: "cmaf-llhls", segmentTarget, partTarget }`.
- Tracks carry `profile: { kind, codec, bitrate, width, height, frameRate, channels, sampleRate, groupId, name, defaultTrack }` instead of those fields at the top level. `TRACK_KINDS`, `LATENCY_PROFILES`, and the `Rendition*` types are gone (`MEDIA_TRACK_KINDS` lives in `/media`).
- Slot-issue requests take `profile: { duration }` instead of `duration`; commit requests take `profile: { independent, programDateTime }` instead of those fields. Slots, commits, and committed objects expose an opaque `profile`; the committed profile is the commit's profile merged over the slot's. `discontinuityBefore` moves into the segment's profile and `discontinuitySequence` into the track window's profile.
- Core no longer requires an init commit per track (HLS rendering still does), no longer applies the `.mp4`/`.m4s` extension rule (pass `extension` explicitly; the media publisher defaults do), and derives object keys under the `objects/` prefix by default.
- Removed: `resolveObjectCreatedEventObservation` and its option and result types from `@arsenstorm/olos/state`. Event deduplication is by slot commit state, not event id, so the helper had no caller.
- Removed: the runtime handler option `clock` (use `now`), the S3 handler option `completionHintClock` (use `completionHintNow`), and `expireUpload`/`rejectUpload` from `@arsenstorm/olos/state` (use `resolveUploadExpiry`/`resolveUploadRejection`). `createMemoryCoordinatorStore` is now the serialized store over the in-memory backend, so it validates snapshots on load like every other store.
- Publisher pacing helpers (`createRuntimeObjectLowLatencyProfile`, `createRuntimeObjectLowLatencyPublisherDefaults`, `createRuntimeObjectLowLatencyManifestOptions`, `DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE`, ...) move from `@arsenstorm/olos/runtime` to `@arsenstorm/olos/media`. Publisher object defaults use `cadenceSeconds` plus an opaque `profile` instead of `duration`; `runPlannedStoredS3PublisherUploadStep` takes `cadenceSeconds` at the top level.
- `@arsenstorm/olos/media` exports the `MediaSession`/`MediaTrack`/`MediaCursor` narrowings, `assertMediaSession`/`assertMediaCursor`/`assertMediaObjectProfile`, `mediaObjectProfile`/`mediaSegmentDuration`, the `OLOS_MEDIA_*_SCHEMA` JSON Schemas, and the media object-key extension helpers.

Alignment with the spec text: a late `committedAt` now rejects with `olos.slot_expired` (409) instead of a 400; `cmaf-llhls` commits reject object keys without the `.mp4`/`.m4s` extension; direct-public grant issuance, commit publication, and the direct-public security policy all require the same five capability flags (`publication.directObjectPublication`, `publication.manifestGatedPublication`, `delivery.negativeCachingPolicyDeclared`, `delivery.documentNavigationCanBeBlocked`, `delivery.immutableCaching`); stored slots must carry `partNumber` if and only if `kind` is `part`; absolute delivery URLs reject `.`/`..`/empty segments; `OLOS_STORAGE_OBJECT_SCHEMA` accepts optional `metadata`; the S3 client tolerates unknown `error.code` values; `_HLS_msn`/`_HLS_part` are parsed as strict decimal integers, and are a 400 on the master path; live-route `:trackId` is validated; the S3 slot route answers 400 on issuance rejections.

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

`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` move from
`dependencies` to optional `peerDependencies`: only `@arsenstorm/olos/s3`
imports them, so consumers of the other subpaths no longer install the AWS
SDK, and consumers of `/s3` now bring their own SDK copy instead of getting
one the package's `dependencies` pinned (install both to use `/s3`; see the
README). Also fixed: `cloneCoordinatorPipelineState` and the memory store's
`cloneCursorView` shallow-copied nested fields (a slot's `byterange`/
`profile`, a cursor's `committedWindow`) despite documenting a deep clone,
so a caller mutating a loaded snapshot could corrupt the store's copy; both
now use `structuredClone`.

Also: completed segments keep their `EXT-X-PART` lines until three target
durations from the playlist end (RFC 8216bis §6.2.2); `CAN-BLOCK-RELOAD`
is advertised only when blocking reload is configured
(`canBlockReload` render option); the late-upload deadline is judged on
S3 `LastModified`, with the request's `committedAt` as fallback only;
byterange responses apply backpressure instead of buffering the whole
range; completion-hint and reconciliation failures return fixed messages
(raw errors go to the new `onError` handler option); completion hints
reject `etag`/`size`; the runtime client honours a `baseUrl` path prefix
and takes `sessionPath`; `GET /sessions` answers 405; live playlist
requests load the cursor view once.
