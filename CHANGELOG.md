# Changelog

Notable package changes are documented here.

This project follows semantic versioning for the published `olos` package.

## 0.3.1

Cleanup release. No protocol shape change.

- The `olos` package `tsconfig.json` now type-checks `e2e/**/*.ts` against
  the source via path mappings. Stale fields (`baseUrl`,
  `publisherInstanceId`, `publicationMode`) and missing narrows were
  fixed in the surfaced e2e files.
- The wire parser (`parseRuntimeSlotIssuePayload`) now validates the
  optional derivation hints — `extension`, `objectKeyNonce`,
  `objectKeyPrefix` — using the same rules the publisher SDK applies, so
  bad hints fail at the boundary instead of being caught later by the
  generated slot's validator.
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
