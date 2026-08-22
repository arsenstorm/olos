# Changelog

## 0.6.0

### Minor Changes

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - Multi-audio support through `#EXT-X-MEDIA:TYPE=AUDIO` groups:

  - `Track` gains the optional `groupId`, `name`, and `defaultTrack`
    fields for HLS audio group membership. Only audio tracks can carry
    them.
  - If a session has grouped audio tracks, the master playlist renders
    one `#EXT-X-MEDIA:TYPE=AUDIO` entry per audio track with committed
    media. Variant streams point to the group with `AUDIO="<groupId>"`, and
    `CODECS` lists only the distinct rendered grouped audio codecs. Each
    grouped audio track gets its own media playlist artifact once it has
    committed media; tracks absent from the committed window are not
    advertised in the master and get no media playlist artifact.
  - `AUTOSELECT` is `YES` only on the group's default track and `NO` on
    the rest. Tracks carry no language or characteristics attributes, so
    RFC 8216 §4.3.4.1.1 allows only one auto-selectable member per group.
  - One audio group per session for now. Validation rejects multiple distinct
    group IDs, multiple default audio tracks, and a mix of grouped and
    ungrouped audio tracks.
  - A session without audio group IDs renders exactly as before.

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - Byterange streaming aligns open-ended ranges with RFC 8673 and releases
  S3 work when the viewer goes away. Any request that carries a Range
  header now answers `206` with
  `content-range: bytes <start>-9007199254740991/*` and no
  `content-length` when the range is open-ended; this includes `bytes=0-`,
  which previously answered `200`. Viewer disconnects and response-body
  cancellation now propagate to the in-flight S3 part fetch, so an
  abandoned response no longer leaks a pooled socket on a stalled part
  read. Bounded ranges clamp part bodies that overshoot the requested
  range, so a part fetch that ignores `Range` cannot push the response
  past its promised `content-length`. Already-aborted viewers no longer
  hold cursor waits open.

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - Byterange segment streaming now fails fast. If a part object returns no
  body or no bytes, the stream errors instead of looping forever. Open-ended
  range responses answer 206 with the RFC 8673 open-ended `content-range`
  form instead of the invalid `content-range: bytes N-/*` header. If a
  bounded 206 response cannot supply the full promised range, the stream
  errors instead of a silent truncation.

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - Commit-path, retention, and cursor-notifier correctness fixes:

  - A multi-track session no longer fails a track's first media
    commit when it arrives out of order (part 1 before part 0). The commit
    is recorded and the track stays out of the committed window until
    its contiguous prefix starts, per spec §5.2/§5.3. Previously the
    window build threw, the commit was lost, and the request failed.
  - An identical commit retry that arrives after the slot deadline now
    returns the idempotent success the spec mandates (§4.5.1/§4.5.2).
    Duplicate resolution compares against the stored commit with
    `committedAt` excluded, so the deadline check no longer rejects
    retries of commits that were accepted on time. New late commits still
    reject.
  - Retention retirement is now per track: a commit retires when its
    own track's visible window has moved past it, not when the
    window-global minimum has. Previously one lagging track kept every
    other track's trimmed commits (and their slots) in state forever
    and their objects were never surfaced for deletion.
  - Session transitions now notify the cursor notifier. Blocking reloads
    parked when a session ends resolve immediately with the terminal
    cursor (`#EXT-X-ENDLIST`) instead of sleeping to the reload timeout
    and serving a stale playlist, and ended sessions are evicted from the
    notifier's memory instead of being retained indefinitely.
  - The cursor notifier now wakes waiters when a notified cursor changes
    window content at an unchanged global position — for example a
    full-segment commit at the live-edge media sequence number, or a
    lagging track completing a segment. Per-track blocking reloads
    no longer miss those updates and wait out the timeout.
  - Publisher-lease recency in `/health` compares timestamp instants, so
    RFC 3339 offsets other than `Z` order correctly.

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - Dedup and consolidation pass:

  - `S3RuntimeHttpError` now extends `RuntimeHttpError`, so
    `error instanceof RuntimeHttpError` also matches S3 client errors. Both
    exported names are unchanged.
  - `S3RuntimeHttpClientOptions` is now a type alias of
    `RuntimeHttpClientOptions`. `S3RuntimeCompleteUploadResponse` is now a
    type alias of `S3RuntimeCommitUploadResponse`. Both pairs were
    structurally identical before, and the exported names are unchanged.
  - BREAKING: `waitForHlsBlockingReload` no longer accepts the `clock`
    option, which duplicated `now`. Pass `now: () => number` instead.
  - BREAKING: the object-key layout for nonce-bearing segments changed.
    Segment filenames are now always position-keyed and flat under the
    track directory:
    - segment without nonce: `<prefix>/<rid>/s<msn>.<ext>` (unchanged)
    - segment with nonce: `<prefix>/<rid>/s<msn>-<nonce>.<ext>`
      (before: `<prefix>/<rid>/s<msn>/segment-<nonce>.<ext>`)
    - part: `<prefix>/<rid>/s<msn>/p<n>[-<nonce>].<ext>` (unchanged)
    - init: `<prefix>/<rid>/init[-<nonce>].<ext>` (unchanged)
      Objects stored under the old form are not re-derived. Keys derive at slot
      issuance, so new sessions get the new layout automatically. To migrate an
      existing archive, re-derive the stored keys with
      `createPublisherObjectKey`. Sessions live across the deploy are a hazard:
      a virtual segment whose part slots were issued under both layouts derives
      two different `byterange.segmentObjectKey` aggregate addresses, so the
      byterange service can serve a truncated segment. Drain or restart live
      sessions around the upgrade. External tooling keyed to the old directory
      layout (bucket lifecycle rules, CDN path rules) also needs updating.
  - Internal consolidation (shared path, timestamp, and error-message
    helpers, the S3 client payload parser collapse, facade-import cleanup,
    and stored coordinator mutation type-threading) keeps behavior the same.

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - Malformed `transitionStoredCoordinatorSession` and
  `heartbeatStoredCoordinatorPublisher` options (bad `sessionId`,
  `publisherInstanceId`, `now`, `ttlMs`, or an unknown state) now reject with
  400 `olos.invalid_request` instead of 409 `olos.invalid_state`, matching
  the spec's status mapping. State-machine rejections (illegal transitions,
  heartbeats against terminal sessions) keep 409 `olos.invalid_state`.
  Clients that dispatch on the error code can now tell permanently malformed
  requests from retryable state conflicts.

  All HTTP error responses now include the schema-required `error.code`
  next to `error.message`. Every error body now conforms to
  `OLOS_ERROR_SCHEMA`. Five new codes exist in `OLOS_ERROR_CODES`:
  `olos.invalid_request`, `olos.not_found`, `olos.method_not_allowed`,
  `olos.conflict`, and `olos.internal`. This change breaks consumers that
  match the previous `{ error: { message } }` shape.

  The runtime handler no longer crashes on unexpected failures: any throw
  that is not an expected 4xx becomes an opaque 500 `olos.internal`
  envelope with a fixed message, so store or infrastructure error text
  never reaches clients. Three request inputs that previously escaped as
  unhandled rejections now resolve to envelopes: a malformed
  `?now=` on the retention route and an unsafe `deliveryBaseUrl` on session
  create are 400 `olos.invalid_request`, and a publisher `committedAt`
  ahead of the server clock reads as a fresh cursor in `/health` instead
  of failing the request.

  The S3 handler now has the same guarantee: every S3 route (grants,
  commits, events, completion hints, reconciliation, retention) wraps its
  dispatch, so an unexpected throw returns a 500 `olos.internal` envelope
  instead of escaping the fetch handler as a platform error. A completion
  hint whose object is not yet visible to `HeadObject` answers 409
  `olos.invalid_state` and leaves the slot awaiting proof, instead of a 500. A heartbeat whose `now` precedes the lease's `issuedAt` (rewound
  clock) rejects with 409 `olos.invalid_state` instead of an opaque 500.
  Unknown session actions return 404 `olos.not_found`; 405 with `Allow` is
  reserved for real actions requested with the wrong method.

  405 responses now carry the RFC 9110-required `Allow` header
  (`jsonMethodNotAllowedResponse` takes the allowed-method list). The live
  manifest 404 is now a JSON `olos.not_found` envelope instead of plain
  text. JSON request bodies are capped (new `maxBodyBytes` handler option,
  default 1 MiB); oversized bodies get 413 with an `olos.invalid_request`
  envelope. `assertOlosErrorEnvelope` / `isOlosErrorEnvelope` are exported
  from `@arsenstorm/olos/validation` for consumers that need to validate
  error bodies at runtime.

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - Make Core media-agnostic and move the CMAF/LL-HLS vocabulary into the new `@arsenstorm/olos/media` subpath. Breaking for every consumer of the wire format and the TypeScript API:

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

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - HLS blocking reload and audio-group fixes:

  - `HlsBlockingReloadRequest` gains an optional `trackId`. When set,
    blocking reloads resolve against that track's own committed-window
    bounds (its last visible segment and part) instead of the window-global
    live edge, so a lagging track blocks until its own playlist changes.
    Requests without a `trackId` keep the window-global behavior, and
    `parseHlsBlockingReloadRequest` never sets it — the blocking manifest
    resolver attaches the track it routes to. The new
    `trackWindowBounds` helper in `olos/src/state/committed-window.ts`
    exposes a track's own live edge.
  - Blocking playlist requests for unknown paths now answer 404 immediately
    instead of being held open for up to `timeoutMs` — bogus paths can no
    longer pin waiters.
  - Delivery directives (`_HLS_msn` / `_HLS_part`) on the master playlist
    path are a 400 (they apply to media playlist requests, RFC 8216bis
    §6.2.5.1), and an `_HLS_msn` more than two beyond the requested
    track's live edge is a 400 as well (RFC 8216bis §6.2.5.2; exactly
    the live edge plus two still blocks).
  - A blocking playlist request now renders only the artifact it asked for —
    the master playlist or the one requested track's media playlist —
    instead of the session's full playlist set on every request. The
    render-all `createHlsManifestArtifacts` and
    `createCoordinatorManifestArtifacts` are unchanged for artifact
    publishing and non-blocking serving.
  - Quoted playlist attribute values are validated instead of
    backslash-escaped: RFC 8216 §4.2 quoted-strings have no escape
    mechanism, so `escapePlaylistValue` (whose `\"` sequences players parse
    literally) is replaced by `quotedPlaylistValue`, which throws on double
    quotes, carriage returns, and line feeds and otherwise returns the value
    verbatim. `assertSession` rejects track names containing those
    characters.
  - Duplicate effective `NAME`s (`name ?? trackId`) within an audio
    group are rejected by both `assertSession` and master playlist rendering
    — duplicate names are ambiguous to players.
  - The audio group's DEFAULT/AUTOSELECT election is stable: the
    session-elected default (the flagged track, else the first declared
    grouped track) no longer flips with committed-window availability.
    While the elected default has no committed media, every rendered member
    carries `DEFAULT=NO,AUTOSELECT=NO`; once it commits, it renders
    `DEFAULT=YES,AUTOSELECT=YES` permanently.

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - HLS playlist correctness fixes:

  - `#EXT-X-MEDIA-SEQUENCE` now comes from the rendered track's own first
    segment instead of the window-global minimum. Playlists stay correct when
    tracks diverge through per-track trimming or dropped empty-media
    segments.
  - Media playlists for ended or aborted sessions now end with
    `#EXT-X-ENDLIST`, so players stop polling terminal sessions. The new
    `endOfStream` option on `renderMediaPlaylist` controls this, and the
    cursor or session state sets it automatically. These sliding-window
    playlists still omit `EXT-X-PLAYLIST-TYPE` by design.
  - A parts-only in-progress segment now reports the sum of its contiguous
    part durations instead of the duration of the first part. A full-segment
    commit keeps its authoritative duration.
  - Blocking reloads against a terminal (`ended`/`aborted`) cursor resolve
    immediately with the final ENDLIST playlist instead of holding the
    request open for the full timeout — no further cursor can ever satisfy
    the request. The internal `isEndOfStreamSessionState` helper moved from
    the HLS manifest artifact module to `olos/src/state/session.ts` (it was
    never part of a public facade).
  - `#EXT-X-DISCONTINUITY-SEQUENCE` is per-track too: `TrackWindow`
    gains an optional `discontinuitySequence` that the renderer prefers over
    the window-global value, and window construction counts trimmed leading
    segments marked `discontinuityBefore` into it. Windows built from commits
    keep the field absent (commits carry no discontinuity markers yet).
  - The master playlist and the manifest artifact set now include only
    tracks present in the committed window. A track that has not
    committed media yet (init-only, or not yet publishing) no longer makes
    playlist rendering throw and fail every playlist request for the
    session; its media route is 404 until media commits, and the master
    picks it up on the next request after its first commit. A session with
    committed audio but no committed video serves no master playlist yet
    (404). `renderMasterPlaylist` gains the optional `availableTrackIds`
    option that implements the filter; omitted, it renders every session
    track as before.

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - Import-path moves and edge portability:

  - The object-key helpers (`createPublisherObjectKey`,
    `createPublisherDeliveryUrl`, `CreatePublisherObjectKeyOptions`,
    `DerivableObjectKind`, `createRuntimePublisherObjectKeyNonce`,
    `RUNTIME_PUBLISHER_OBJECT_KEY_NONCE_MIN_BYTES`, and
    `CreateRuntimePublisherObjectKeyNonceOptions`) moved from
    `@arsenstorm/olos/runtime` to `@arsenstorm/olos/state`. Their
    implementations already lived there.
  - `assertSerializedCoordinatorStoreBackendConformance` and
    `AssertSerializedCoordinatorStoreBackendConformanceOptions` moved from
    `@arsenstorm/olos/protocol` to `@arsenstorm/olos/conformance`, next to
    the other store conformance harnesses.
  - `createCoordinatorManifestArtifacts`, `CoordinatorManifestArtifacts`, and
    `CreateCoordinatorManifestArtifactsOptions` moved from
    `@arsenstorm/olos/protocol` to `@arsenstorm/olos/hls`. An import of the
    protocol subpath no longer pulls in the HLS renderer.
  - Published type declarations no longer reference Bun global types, and the
    object-key nonce encoder no longer depends on `Buffer`. The package
    type-checks and runs on edge runtimes without Bun or Node globals.

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - Emitted `dist/*.js` modules now carry explicit `.js` extensions on
  relative imports. The package now resolves under Node's ESM loader. Before
  this change, only Bun's tolerant resolver could load it. The packed-tarball
  smoke test now runs under Node when Node is available, and that test found
  this error.

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - 0.6.0 project-wide improvement release.

  Infrastructure and tooling:

  - Versioning and changelogs migrate to Changesets. Package validation
    migrates to `publint` and `@arethetypeswrong/cli`, plus a slim
    packed-tarball smoke test that runs under Node. These replace about 25
    hand-rolled release scripts.
  - CI is restructured. Type checks cover every workspace, including
    `olos/scripts`, `olos/live`, benchmarks, and the examples. A Node 22/24
    matrix builds the package and runs the E2E suite. The workflows gain
    dependency caching, concurrency groups, and job timeouts. Dependabot now
    regenerates `bun.lock`, and the audit gate is clear again.
  - Publishing gains an `npm` environment gate and a tag-on-main ancestor
    check. npm OIDC trusted publishing stays in place.

  The library changes have their own changesets.

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - The OLOS protocol now has a full normative specification in the
  repository's `spec/` directory. It has 11 sections plus generated
  appendices, anchored to the conformance assertion set.
  `OLOS_SPEC_STATUS` is now `draft-v1.0.0`. The new
  `OLOS_CONFORMANCE_SPEC_REFS` export maps each conformance assertion ID to
  the spec section that specifies it, or `null` when the assertion is not
  yet referenced by a spec section (currently 101 of 133 are mapped).

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - Retention pruning can now persist outside the commit path. The new
  `applyCoordinatorRetention` (olos/protocol) prunes expired issued slots and
  out-of-window commits through the same core that the commit path uses. The
  new `applyStoredCoordinatorRetention` (olos/runtime) saves the pruned state
  back through the coordinator store. If nothing changed, it does not save.
  The S3 retention route now persists the pruned state before it deletes
  remote objects, so a delete failure cannot leave an unpruned snapshot
  growing. Known limit: a failed delete is not re-planned by later sweeps
  (the pruned state no longer references the object). Failures surface in
  the 202 response body for caller-driven retry; configure a bucket
  lifecycle rule as the backstop for orphaned objects.
  `deleteRetiredCoordinatorObjects` and `deleteRetiredS3CoordinatorObjects`
  gain an opt-in `concurrency` option (default 1). The option bounds parallel
  deletes and preserves result order.

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - Schema and runtime validation are now aligned:

  - Timestamps must be RFC 3339 date-time strings, which matches the schemas'
    `format: "date-time"`. Before this change, the runtime validators
    accepted any `Date.parse`-able string, such as `"2026-01-01"` or
    `"Jan 1 2026"`.
  - `uploadSlot.maxBytes`, `commit.size`, and `mediaObject.size` must be
    positive integers on both the schema side and the validator side. Before
    this change, fractional values passed.
  - `createObservedUploadFromHeadObject` normalizes string `lastModified`
    values (for example an HTTP `Last-Modified` header) to RFC 3339 before
    validation, so lenient provider timestamps keep working under the
    stricter rules. Unparseable values throw
    `lastModified must be a valid timestamp`.
  - Persisted 0.5 snapshots that contain lenient timestamps or fractional
    sizes (only possible if a client supplied them) fail validation on the
    next read; there is no compatibility shim. Internally generated
    timestamps were always RFC 3339 and are unaffected.
  - Every wire-document validator is now closed, matching the schemas'
    `additionalProperties: false`: `assertStorageObject`, `assertUploadGrant`,
    `assertProviderCapabilityDocument` (top level and every sub-object),
    `assertCommittedWindow` (window, track windows, segments, committed
    objects, and parts), and the nested `byterange` object all reject unknown
    properties. This breaks producers that attached extra fields to these
    documents; `assertCommit`, `assertUploadSlot`, `assertCursor`, and
    `assertSession` were already closed.
  - Timestamps are strict in BOTH directions. The validators reject leap
    seconds, hour 24, space separators, colon-less offsets, and impossible
    calendar dates (for example `2026-02-30`); the schemas' timestamp fields
    carry a matching `pattern` (`RFC3339_TIMESTAMP_SCHEMA_PATTERN`) so
    schema-only validators reject the same strings — except impossible
    calendar dates, which need a format-aware validator (ajv-formats in full
    mode) or the runtime validators. `uploadCompletionHint.eventTime` is
    strict too; normalize provider formats (HTTP dates) before building the
    hint.
  - Wire integers (`size`, `maxBytes`, sequence numbers, and other integer
    fields) must be JavaScript-safe integers; values at or above `2 ** 53`
    are rejected by the validators even though JSON Schema accepts them.
  - `assertCursor` enforces spec §3.8: a present `cursor.window.lastPartNumber`
    must equal the committed window's last visible part number.
  - NON-breaking, per spec §11.2 (consumers must ignore unknown fields): the
    runtime and S3 HTTP clients now prune unknown fields from response
    payloads (slots, grants, commits, cursors, retention and reconciliation
    bodies) before validating, so talking to a newer coordinator keeps
    working. The tolerant read-path parsers are exported from
    `olos/validation` as `parseCursor`, `parseCommit`, `parseUploadSlot`,
    and `parseUploadGrant`; each returns a pruned copy validated by the
    unchanged closed assert. Server-side request parsing stays closed.
  - The schema drift suites now cover all 9 exported OLOS JSON schemas with
    `ajv-formats` format validation on. They also test validator-only
    payloads for constraints that JSON Schema cannot express, for example
    `minBytes <= maxBytes`, unsafe integers, and the cursor
    `lastPartNumber` cross-check, plus unknown-field exemplars at top level
    and nested levels.

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - The sqlite/D1 serialized-store backend now implements the
  `loadCursorView` fast path through a new nullable `cursor_view` column.
  Existing deployments upgrade with the new
  `migrateSqliteSerializedCoordinatorStoreSchema` (olos/protocol): it runs
  the `create table if not exists` DDL and then adds the missing
  `cursor_view` column, using only prepared statements (no PRAGMA writes or
  transactional DDL, so it works on Cloudflare D1), tolerating racing
  migrators, and staying idempotent — safe to run on every startup.
  `createSqliteSerializedCoordinatorStoreSchema` alone only covers fresh
  installs, because `create table if not exists` does not alter an existing
  0.5.x table. If a row has a NULL `cursor_view` (a pre-migration row),
  `loadCursorView` returns a null-view record and the store falls back to
  the full-snapshot path, so manifest reads keep working after the column
  is added. `SerializedCursorViewRecord.view` is `string | null`: backends
  return `undefined` only for missing sessions and a null view for sessions
  without a stored view — backends that return `undefined` for existing
  sessions fail the conformance harness. D1-style clients whose `first()`
  resolves `null` for missing rows no longer throw on load. Serialized
  cursor views are validated on read instead of cast, and the view JSON now
  embeds the record's etag, which is cross-checked on read — a view row
  paired with the wrong etag throws instead of serving a stale or foreign
  view.

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - Store and retention consistency fixes:

  - `createSerializedCoordinatorStore` derives the next etag from the
    caller's `expectedEtag` instead of pre-loading the current record, so
    every save costs one backend round trip and cannot race a concurrent
    writer between load and save; the backend's atomic etag check still
    decides, and conflicts keep returning the winning record.
  - The memory coordinator store's `loadCursor` clones the snapshot before
    projecting the view, so returned views never alias stored state.
  - `assertCoordinatorPipelineStoreConformance` now exercises `loadCursor`
    when a store implements it: missing sessions resolve `undefined`, the
    view's etag and session match the loaded snapshot, no cursor is
    reported before a commit, and views must not alias each other or the
    stored state. Custom stores whose `loadCursor` aliases stored state
    will start failing the harness.
  - Retention honors `lateToleranceMs` end to end: `selectExpiredUploadSlots`,
    `planCoordinatorRetention`, `applyCoordinatorRetention`, the stored
    plan/apply flows, the runtime retention route, and the S3 retention
    route all accept the option, and commit-time auto-retention reuses the
    commit's own tolerance — so a sweep can no longer prune a slot whose
    late upload would still commit.
  - `uploadCompletionHint.eventTime` is validated as strict RFC 3339 instead
    of any `Date.parse`-able string (HTTP-date `Last-Modified` normalization
    stays lenient).
  - The S3 runtime client now surfaces per-slot reconciliation failure
    details — the `error` envelope (`code`, `message`, optional `details`)
    and `resultStatus` the server already emitted — on failed results
    instead of dropping them.

### Patch Changes

- [#28](https://github.com/arsenstorm/olos/pull/28) [`4df2af0`](https://github.com/arsenstorm/olos/commit/4df2af00b44f93998d36d64d8ce9ab346e199e9c) Thanks [@arsenstorm](https://github.com/arsenstorm)! - Fix two manifest defects that made rendered playlists unplayable by native
  HLS players (Safari and any other AVFoundation-based client). MSE players
  such as hls.js tolerate both, so neither showed up in browser playback.

  - `HOLD-BACK` is now rendered as `max(3 × EXT-X-TARGETDURATION,
targetLatency)`. RFC 8216bis Section 4.4.3.8 floors the tag at three
    target durations, and Apple's player rejects the entire playlist below it
    (`HOLD-BACK less than 3 * target-duration`, CoreMedia -12646), taking down
    every variant with it. A `targetLatency` under the floor is raised rather
    than rejected — it is a deployment latency goal, not the wire tag, and the
    floor moves with `segmentTarget`. Deployments that set a low
    `targetLatency` will see a larger `HOLD-BACK` in the rendered manifest;
    the low-latency path is driven by `PART-HOLD-BACK`, which is unchanged.
  - A commit's `programDateTime` now reaches the committed window's segments.
    `CommittedSegment.programDateTime` existed and the renderer emitted
    `EXT-X-PROGRAM-DATE-TIME` from it, but nothing ever copied the field off
    the commit, so the tag could not be produced at all. The first commit at a
    media sequence that carries the field — part 0 for a parted segment,
    otherwise the segment commit — now anchors the segment's wall-clock start.
    Apple's low-latency profile requires the tag and drops out of low-latency
    mode without it (CoreMedia -15412).

## 0.5.1

Tightens the out-of-order commit path 0.5.0 introduced.

- **Retention no longer retires future-but-not-visible commits.**
  `selectRetiredCommittedObjects` now requires
  `commit.mediaSequenceNumber < retainedWindow.firstMediaSequenceNumber`.
  Without this, a parallel-publisher commit landing ahead of the
  contiguous prefix (e.g. part 3 of segment N before parts 0–2) had its
  slot pruned and its backing object scheduled for delete; once the
  earlier parts arrived, the missing part broke the manifest. Same fix
  applies to `planCoordinatorRetention`.
- **`cursor.window.lastPartNumber` derives from the visible window.**
  `commitCoordinatorUpload` previously took `Math.max(...partNumbers)` over
  raw commits, which leaked an out-of-order future part number into the
  cursor while the window's last segment was still the previous MSN.
  Replaced with `lastVisiblePartNumber(committedWindow)`.

## 0.5.0

_Not published to npm; these changes shipped in 0.5.1._

Makes the deploy story Workers-Free-viable. 0.4.0 bounded the persisted
state surface (`objectKey`/`deliveryUrl` no longer wire fields). This
release bounds the per-request CPU so a long-running session no longer
trips the 10 ms cap on Workers Free — and stays cheap on paid plans too.
The 0.4.1 changes (commit retention + auto-delete) are folded in.

- **Slot retention.** `commitCoordinatorUpload` now also drops slots that
  belong to retired commits AND slots whose `expiresAt` has passed without
  an upload. Combined with the commit prune, every persisted state field
  stays bounded by the live window regardless of session age.
- **Commit retention.** `commitCoordinatorUpload` prunes commits behind
  `cursor.committedWindow.firstMediaSequenceNumber` from `state.commits`
  and returns them as `retiredObjects: readonly RetiredCommittedObject[]`
  on the result. `state.commits` stays O(window).
- **Persistence split.** `CoordinatorPipelineStore` gains optional
  `loadCursor(sessionId)` returning `CoordinatorCursorView` (`cursor +
session + etag`). `SerializedCoordinatorStoreBackend` gains optional
  `loadCursorView`; `SaveSerializedCoordinatorStoreOptions` gains optional
  `cursorView: SerializedCursorViewRecord` (`{etag, view}`). The runtime
  manifest handlers (`serveStoredCoordinatorManifest` /
  `serveStoredBlockingCoordinatorManifest`) read the cursor view when the
  store provides one; the LL-HLS manifest GET no longer parses the full
  warm-path snapshot. Backends that don't implement `loadCursorView` fall
  back transparently to load+extract — no breakage for existing
  implementations.
- **waitUntil for retention deletes.** `StoredS3CoordinatorRuntimeHandler`
  now accepts a `ctx?: { waitUntil(promise) }` argument. When provided,
  the inline auto-delete added in this release flows through
  `ctx.waitUntil` so SigV4 signing CPU is paid outside the request budget.
  Without a ctx (tests / non-CF runtimes), deletes await inline as before.
- **`createStoredS3CoordinatorRuntimeHandler` auto-delete.** The S3 commit,
  completion-hint, S3 event-routing, and reconciliation handlers delete
  each `retiredObjects` entry from the configured S3/R2 client. The
  dedicated `/s3/retention` route stays available as a sweeper for state
  committed without `maxSegments`, but a publisher that sets it gets
  cleanup for free.
- **`examples/api` DO splits storage by access pattern.** The
  `StreamCoordinator` Durable Object writes both `state-record` (full
  snapshot) and `cursor-record` (hot view) in one `ctx.storage.put` batch.
  The legacy `coordinator-record` key is read transparently on first load
  after upgrade (no DO migration needed) and replaced on the next save.
  `examples/api/src/index.ts` threads `ctx` into the handler so retention
  deletes run via `waitUntil`.
- **`examples/streamer` and `examples/api/scripts/publish-demo`** set
  `maxSegments: 6` on every commit (12 s LL-HLS DVR window with 2 s
  segments), enabling the bounded-state path by default.
- **Out-of-order commit tolerance.** `tryCreateCommittedWindow` (new,
  exported from `olos/state`) is the OOO-safe variant of
  `createCommittedWindow` — it returns `undefined` instead of throwing
  when no contiguous part prefix exists. `commitCoordinatorUpload` uses
  it: when an out-of-order commit lands first (e.g., part 3 of a segment
  before parts 0/1/2), the commit is still recorded in `state.commits`
  but the cursor stays put. The next contiguous commit advances it. This
  is what makes parallel-publish-per-segment safe.
- **`examples/streamer` pipelines parts within a segment.** Each
  segment's 4 parts run through a three-phase pipeline: serial slot
  grants → parallel R2 PUTs → serial coordinator commits. Three new
  `OlosClient` methods expose the split: `issueGrant` and
  `commitPublication` (each a coordinator state mutation — must
  serialize across parts of the same session to avoid etag-conflict
  retry storms that would blow the Workers Free 10 ms CPU cap) and
  `uploadGranted` (the parallel-safe R2 PUT). Per-segment-cycle wall
  time drops from ~2.25 s (full serial, ~250 ms/cycle ambient lag
  growth) to ~1.3 s — sub-second glass-to-glass latency stays stable
  across long sessions on Workers Free.
- **`examples/api` secrets.** `MEDIA_ORIGIN` and `USE_R2_BINDING` moved
  from `wrangler.jsonc` vars to required secrets so each contributor's
  deploy uses their own values without touching tracked config.
  `.dev.vars.example` documents the local defaults; `README.md` updates
  the production secrets list.

## 0.4.0

Hard-removes the wire compat for publisher-supplied object addresses. The
SDK has been intent-first since 0.3.0; 0.4.0 makes the wire match.

- `IssueCoordinatorSlotOptions` no longer accepts `objectKey` or
  `deliveryUrl`. `parseRuntimeSlotIssuePayload` now **rejects** both — old
  clients fail fast at the wire boundary rather than later at commit
  time. Publishers send intent (`kind`, `mediaSequenceNumber`,
  `renditionId`, `slotId`, optional `partNumber` /
  `objectKeyNonce` / `objectKeyPrefix` / `extension`); the coordinator
  derives `objectKey` and `deliveryUrl` from intent plus its configured
  `mediaBaseUrl`, every time.
- The `examples/streamer` (OBS bridge) and `examples/api/scripts/publish-demo`
  scripts now omit `objectKey` / `deliveryUrl` on slot requests, read the
  derived address from the issued slot, and pass shared per-segment
  `objectKeyNonce` values for byterange parts so the part slots and the
  segment slot agree on the segment object address.
- `Byterange.segmentObjectKey` and `Byterange.segmentDeliveryUrl` are
  documented as virtual byterange identifiers used by the manifest
  renderer and the application's virtual-segment route — **not**
  object-store publication authority. Publishers SHOULD derive them with
  `createPublisherObjectKey` and a shared per-segment `objectKeyNonce`.

## 0.3.1

_Not published to npm; these changes shipped in 0.4.0._

Cleanup release. No protocol shape change.

- The `olos` package `tsconfig.json` now type-checks `e2e/**/*.ts` against
  the source via path mappings. Stale wire-payload fields
  (`publisherInstanceId`, per-slot `publicationMode`), obsolete SDK
  fields (`baseUrl`), and missing narrows were fixed in the surfaced
  e2e files.
- The wire parser (`parseRuntimeSlotIssuePayload`) now validates the
  optional derivation hints — `extension`, `objectKeyNonce`,
  `objectKeyPrefix` — using the same rules the publisher SDK applies, so
  bad hints fail at the boundary instead of being caught later by the
  generated slot's validator. The parser now also rejects `partNumber`
  on non-part kinds and requires it when `kind` is `"part"`, matching
  the SDK rule.
- `contributing/core/conformance.md` notes that `CORE-RUNTIME-*`
  assertion identifiers are legacy-labelled; the `level` field is
  authoritative.

## 0.3.0

Spec-completion release. Breaking SDK changes; wire stays soft-compatible.

- Publisher SDK is now intent-first. `CreateRuntimePublisherObjectPlanOptions`
  no longer requires `baseUrl` or `extension`; the coordinator chooses the
  `objectKey` and `deliveryUrl` from intent plus its configured
  `mediaBaseUrl`. The plan still exposes a client-side `objectKey` preview
  field (computed from the same derivation) so publishers can predict the
  eventual address when they supply their own nonce.
- `IssueCoordinatorSlotOptions` still accepts optional `objectKey` /
  `deliveryUrl` for tests and advanced SDK use, but the wire-side parser
  treats them as compat-mode hints — the strict path through the
  coordinator is intent + derivation. Direct-public deployments should
  rely on derivation and audit any compat use.
- Conformance bucket re-cut. `CORE-RUNTIME-*` assertions moved out of
  `core` into a new `runtime` level. Core now holds only the
  protocol-essential 38 assertions (slot issuance, commit idempotency,
  cursor monotonicity, window ordering, etc.). The total stays 127.
- `README` names the layered model — Core, LL-HLS Profile, S3 Binding,
  Direct-Public Deployment, Runtime Guidance — so the substrate framing
  is explicit instead of implied.

## 0.2.1

_Not published to npm; these changes shipped in 0.3.0._

Follow-up cleanup to the 0.2.0 simplification. No protocol shape change.

- Re-export `createPublisherObjectKey`, `createPublisherDeliveryUrl`,
  `CreatePublisherObjectKeyOptions`, and `DerivableMediaObjectKind` from
  `olos/runtime`, matching the 0.2.0 changelog.
- Core validators (`assertSession`, `assertUploadSlot`, `assertCommit`,
  `assertCursor`, `assertCursorWindow`, `assertRendition`) now reject
  unknown properties, matching the JSON schemas' `additionalProperties:
false` declaration.
- Removed stale `tenantId`, `publicationMode`, and `publisherInstanceId`
  references from the e2e fixtures and `contributing/core` docs.

## 0.2.0

Core surface simplification. Breaking changes throughout core types,
schemas, and the runtime APIs. No migration shims — pre-1.0; consumers
re-pin and rebuild.

- Dropped dead enum members: `MEDIA_OBJECT_KINDS` no longer includes
  `"sidecar"`; `UPLOAD_SLOT_STATES` drops `"announced"` (and its
  `committed → announced` transition); `LATENCY_PROFILES` trims to
  `["object-ll"]`; `SESSION_STATES` trims to
  `["live", "ending", "ended", "aborted"]` with the orchestration
  states (`created`, `starting`, `expired`) and their transitions
  removed. Sessions are created directly in `"live"`.
- Removed `providerId` from `Commit` and `ObjectPublication`. Provider
  identity stays on `MediaObject`, `ProviderCapability`, and the S3
  binding internals.
- Lifted `publicationMode` from `UploadSlot`, `Commit`, and
  `ObjectPublication` into coordinator-runtime configuration. The
  stored coordinator runtime handler now accepts `publicationMode`
  once at construction.
- Collapsed `Cursor.pathways` to a single `mediaBaseUrl: string`. The
  `Pathway` type, `PATHWAY_STATES`, `OLOS_PATHWAY_SCHEMA`,
  `resolvePathwayFailover`, and the pathway validators are removed
  from the public surface. Session-create requests and
  `createRuntimeSession` take `mediaBaseUrl` instead of `pathways`.
- The coordinator derives `objectKey` and `deliveryUrl` server-side
  when omitted from the slot-issue request, using the same key scheme
  as the publisher-plan SDK plus a generated nonce in direct-public
  mode. Publisher-supplied values continue to be accepted and
  validated.
- Removed `tenantId` from `Session`, `UploadSlot`, `Cursor`, and
  `CoordinatorPublisherLease`. Removed `publisherInstanceId` from
  `UploadSlot` (it stays on the lease record and heartbeat payload,
  where it identifies the lease).
- Moved `createRuntimePublisherObjectKeyNonce` and the new
  `createPublisherObjectKey` / `createPublisherDeliveryUrl` helpers
  into `olos/src/state/`. The public `olos/runtime` re-exports them.

## 0.1.1

- Updated GitHub Actions workflows to use npm provenance OIDC for package
  publication and pin versioned dependencies.
- Declared `engines.node >= 22`.

## 0.1.0

- Added optional `byterange` field to `UploadSlot`, `Commit`, and
  `CommittedPart`. When a part declares a byterange + `segmentObjectKey` +
  `segmentDeliveryUrl`, the manifest renders `#EXT-X-PART:BYTERANGE="L@O"`
  against the virtual segment URI rather than a per-part URL, enabling
  spec-compliant LL-HLS byte-range parts. Per-part-URL parts continue to
  work unchanged.
- Added `#EXT-X-PRELOAD-HINT:TYPE=PART,BYTERANGE-START=N` rendering after
  the last byterange part of the in-progress segment.
- Added `HLS-BYTERANGE-001`, `HLS-BYTERANGE-002`, `HLS-BYTERANGE-003`
  conformance assertions covering byterange validation, manifest
  rendering, and preload-hint emission.
- Added core OLOS protocol types, validation, and coordinator state helpers.
- Added stored runtime helpers for sessions, upload slots, commits, manifests,
  retention, publisher liveness, and publisher upload loops.
- Added configurable late upload tolerance for runtime and S3 commit paths.
- Added publication controls and app-owned commit policy hooks for runtime,
  S3, provider-event, and recovery commit paths.
- Added HLS and LL-HLS manifest generation with blocking reload support.
- Added S3-compatible upload grants, object observation, event routing,
  reconciliation, and retention helpers.
- Added S3-native slot metadata binding and observation normalization.
- Hardened S3-compatible upload grant and live-provider test configuration
  validation.
- Added in-memory and SQLite-backed serialized coordinator store adapters.
- Added conformance coverage metadata and package publication checks.
