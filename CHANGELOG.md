# Changelog

Notable package changes are documented here.

This project follows semantic versioning for the published `olos` package.

## 0.5.0

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
