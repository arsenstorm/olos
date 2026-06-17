# OLOS Conformance

Status: `draft-v0.1.2`

## 1. Abstract

This document defines OLOS conformance levels and the executable assertions needed for interoperable implementations.

The v0.1.2 conformance goal is practical interoperability between:

```text
one publisher
one coordinator
one object-store provider binding
one LL-HLS manifest gateway
one hostile-publisher test suite
```

## 2. Conformance levels

### 2.1 OLOS-Core conforming

An implementation is OLOS-Core conforming if it implements:

```text
sessions
upload slots
upload grants
media object metadata
commits
cursors
CommittedWindow
epochs/discontinuities
pathways
core error model
```

### 2.2 OLOS-Object conforming

An implementation is OLOS-Object conforming if it implements:

```text
exact-key upload grants
object existence checks
create-if-absent or equivalent conflict protection
immutable committed object semantics
provider capability document
manifest-gated publication
cache-safety declarations
```

### 2.3 OLOS-HLS conforming

An implementation is OLOS-HLS conforming if it renders:

```text
master playlist
media playlist from CommittedWindow
EXT-X-MAP
EXT-X-PART
EXT-X-SERVER-CONTROL
EXT-X-DISCONTINUITY where required
safe URI handling
```

### 2.4 OLOS-R2 profile conforming

An implementation is OLOS-R2 conforming if it implements the R2 profile:

```text
single-bucket direct object publication
R2 pre-signed PUT upload slots
R2 HeadObject or object-created event handling
conditional upload where practical
R2 custom-domain media delivery
R2 cache-safety rules
```

## 3. Assertion format

Executable conformance tests SHOULD be identified using stable assertion IDs.

Assertion IDs use this shape:

```text
AREA-NNN
```

Examples:

```text
CORE-SLOT-001
CORE-COMMIT-002
OBJ-CACHE-001
HLS-GOLDEN-001
SEC-DIRECT-001
```

Each assertion SHOULD define:

```text
initial state
input event or operation
expected state transition
expected output
negative conditions
```

## 4. Core schema assertions

| ID | Scenario | Expected result |
|---|---|---|
| `CORE-SCHEMA-001` | Core JSON schemas are exported | Stable schemas exist for the exported wire objects. |

## 5. Coordinator store assertions

| ID | Scenario | Expected result |
|---|---|---|
| `CORE-STORE-001` | Load missing coordinator session | Store returns no state without creating one. |
| `CORE-STORE-002` | Save new coordinator state | Store persists the session state and returns a new ETag. |
| `CORE-STORE-003` | Save with matching ETag | Store updates the state atomically and advances the ETag. |
| `CORE-STORE-004` | Save with stale ETag | Store rejects the write and returns the current state when available. |
| `CORE-STORE-005` | Concurrent first save races existing row | One write wins; the other returns a conflict. |
| `CORE-STORE-006` | Serialized backend stores coordinator snapshots | JSON snapshots can be adapted to the coordinator store contract. |
| `CORE-STORE-007` | Serialized backend handles stale conditional writes | Conflict responses expose the latest stored snapshot. |
| `CORE-STORE-008` | SQLite-style backend reports write conflicts | SQLite adapters use changed-row counts to preserve conditional writes. |

## 6. Core state-machine assertions

| ID | Scenario | Expected result |
|---|---|---|
| `CORE-SLOT-001` | Create upload slot for active session | Slot state is `issued`; exact object key and expiry are present. |
| `CORE-SLOT-002` | Observe object for issued slot | Slot state becomes `upload_observed`; cursor does not advance yet unless commit policy runs. |
| `CORE-SLOT-003` | Commit observed valid slot | Slot state becomes `committed`; commit record is created exactly once. |
| `CORE-SLOT-004` | Announce committed slot through manifest gateway | Slot state MAY become `announced`; committed window includes the object. |
| `CORE-SLOT-005` | Expire issued slot before upload | Slot state becomes `expired`; future upload observation is rejected unless late tolerance is configured. |
| `CORE-SLOT-006` | Revoke committed but unannounced slot | Slot state becomes `revoked`; committed window omits it; cursor does not advance through it. |
| `CORE-SLOT-007` | Attempt to revoke announced slot silently | Operation is rejected; implementation must freeze, abort, start new epoch/discontinuity, or disable/read-gate pathway. |

## 7. Commit assertions

| ID | Scenario | Expected result |
|---|---|---|
| `CORE-COMMIT-001` | Commit unknown slot | Reject with `olos.unknown_slot`. |
| `CORE-COMMIT-002` | Commit object key different from slot object key | Reject with `olos.key_mismatch`. |
| `CORE-COMMIT-003` | Commit oversized object | Reject with `olos.object_too_large`. |
| `CORE-COMMIT-004` | Commit same slot twice with identical metadata | Return original commit idempotently; do not advance cursor twice. |
| `CORE-COMMIT-005` | Commit same slot twice with different ETag, size or object key | Reject with `olos.duplicate_commit_conflict`. |
| `CORE-COMMIT-006` | Commit object before provider event or HeadObject proves existence | Reject or keep slot uncommitted. |
| `CORE-COMMIT-007` | Commit after session is aborted | Reject with `olos.invalid_state`. |
| `CORE-COMMIT-008` | Commit part N+1 while required part N is missing | Do not advance cursor beyond the gap unless discontinuity/gap policy is explicitly invoked. |

## 8. Late slot and event-ordering assertions

| ID | Scenario | Expected result |
|---|---|---|
| `CORE-LATE-001` | Object event arrives after slot expiry with no late tolerance | Reject or mark ignored; do not commit. |
| `CORE-LATE-002` | Object event arrives within configured late tolerance | MAY commit if all other metadata checks pass. |
| `CORE-EVENT-001` | Duplicate object-created event | Processing is idempotent; one commit at most. |
| `CORE-EVENT-002` | Client completion hint arrives before storage event | Slot may become `upload_observed_pending`; coordinator must verify via HeadObject or trusted event before commit. |
| `CORE-EVENT-003` | Storage event arrives before client completion hint | Coordinator may commit without client hint if object metadata and policy pass. |
| `CORE-EVENT-004` | Event for unknown object key | Ignore, audit or reject; do not create implicit slot. |
| `CORE-EVENT-005` | Overwrite event for committed object | Reject as conflict; do not update committed window. |

## 9. CommittedWindow assertions

| ID | Scenario | Expected result |
|---|---|---|
| `CORE-WINDOW-001` | Cursor exposes live edge | Cursor contains `window` summary and `committedWindow`. |
| `CORE-WINDOW-002` | CommittedWindow contains init object | HLS gateway can render `EXT-X-MAP`. |
| `CORE-WINDOW-003` | CommittedWindow has non-monotonic media sequences | Gateway refuses to render or returns deterministic protocol error. |
| `CORE-WINDOW-004` | CommittedWindow has duplicate part position with different URL | Gateway refuses to render or returns deterministic protocol error. |
| `CORE-WINDOW-005` | CommittedWindow lacks required duration | Gateway refuses to render. |
| `CORE-WINDOW-006` | Discontinuity flag appears before segment | HLS output includes `EXT-X-DISCONTINUITY` at that position. |
| `CORE-WINDOW-007` | Window slides forward | `firstMediaSequenceNumber` increases only after older entries age out according to policy. |

## 10. Runtime assertions

| ID | Scenario | Expected result |
|---|---|---|
| `CORE-RUNTIME-001` | Stored coordinator lifecycle runs through runtime exports | Session creation, slot issue, commit and manifest rendering operate through public runtime helpers. |
| `CORE-RUNTIME-002` | Stored coordinator lifecycle runs through SQLite serialized store | SQLite-backed serialized state preserves the runtime pipeline contract. |
| `CORE-RUNTIME-003` | Object low-latency profile drives publish and manifest flow | Runtime defaults stay within the target live-latency budget. |
| `CORE-RUNTIME-004` | Runtime routes operate through Fetch requests | Stored coordinator routes return structured HTTP responses. |
| `CORE-RUNTIME-005` | Unsupported runtime requests | Route errors are deterministic and structured. |
| `CORE-RUNTIME-006` | Retention is planned from stored coordinator state | Runtime returns app-owned retention work without mutating the cursor. |
| `CORE-RUNTIME-007` | Publisher loop completes one object | Issue, upload and commit steps produce one committed object or an explicit failure. |
| `CORE-RUNTIME-008` | Publisher lease is created and refreshed | Heartbeats extend the matching publisher lease and reject mismatches. |
| `CORE-RUNTIME-009` | Publisher object plan is derived | Planned init, segment and part payloads have deterministic IDs and object keys. |
| `CORE-RUNTIME-010` | Publisher expiry is derived from cadence | Slot expiry respects object duration, target latency and minimum TTL. |
| `CORE-RUNTIME-011` | Live health is classified | Health reports active, starting or stale state from cursor and publisher lease data. |
| `CORE-RUNTIME-012` | Object low-latency defaults are created | Runtime, publisher and manifest options are derived from one latency profile. |
| `CORE-RUNTIME-013` | Publisher cadence resolves next segment | Next segment position follows the trusted cursor. |
| `CORE-RUNTIME-014` | Publisher cadence resolves next part | Low-latency part position advances through the segment before the next segment. |
| `CORE-RUNTIME-015` | Publisher loop reports explicit failures | Failed issue, upload or commit steps do not masquerade as success. |
| `CORE-RUNTIME-016` | Publisher sends stored coordinator heartbeat | Coordinator stores or refreshes the matching publisher lease. |
| `CORE-RUNTIME-017` | Runtime health is read from stored coordinator state | Health reflects cursor freshness and stored publisher lease status. |
| `CORE-RUNTIME-018` | Runtime client calls heartbeat and health routes | Client sends canonical requests and returns parsed lease or health payloads. |
| `CORE-RUNTIME-019` | Runtime client publishes and reads playlists | Public client flow commits media and fetches generated HLS playlists. |
| `CORE-RUNTIME-020` | Runtime slot request contains unsafe protocol identifiers | Request is rejected before coordinator mutation. |
| `CORE-RUNTIME-021` | Runtime commit request contains unsafe protocol identifiers | Request is rejected before coordinator mutation. |
| `CORE-RUNTIME-022` | Runtime heartbeat request contains unsafe publisher identifier | Request is rejected before publisher lease mutation. |
| `CORE-RUNTIME-023` | Runtime route contains unsafe session identifier | Request is rejected before coordinator store access. |
| `CORE-RUNTIME-024` | Runtime route contains malformed percent encoding | Request is rejected with a deterministic bad-request response. |

## 11. Object-binding assertions

| ID | Scenario | Expected result |
|---|---|---|
| `OBJ-LAYOUT-001` | Create direct-public object key with per-slot nonce | Key follows the canonical init, segment, or part layout and includes the nonce. |
| `OBJ-GRANT-001` | Create upload grant | Grant is exact-key, method-bound and expiry-bound. |
| `OBJ-GRANT-002` | Upload with wrong key | Provider or coordinator rejects; slot is not committed. |
| `OBJ-GRANT-003` | Upload with wrong content type | Provider rejects where signed headers are supported; otherwise coordinator rejects before commit where metadata is available. |
| `OBJ-GRANT-004` | Attempt overwrite with create-if-absent | Provider rejects or coordinator treats as conflict before commit. |
| `OBJ-GRANT-005` | Provider cannot issue OLOS-required grants | Direct-public grant planning is rejected before issuing unsafe credentials. |
| `OBJ-HEAD-001` | HeadObject after successful upload | Metadata includes object key, size, ETag/checksum where available and content type where available. |
| `OBJ-PUB-001` | Public single-bucket object exists before commit | Official manifests do not include the object until commit. |
| `OBJ-PUB-002` | Deployment declares read-gated publication | Uncommitted object reads are denied by the declared gate. |
| `OBJ-FLOW-001` | Stored S3 upload is committed through coordinator state | Official HLS output includes the committed delivery URL. |
| `OBJ-FLOW-002` | Planned S3 publisher step uploads and commits | Grant, upload and commit produce stored HLS state. |
| `OBJ-FLOW-003` | Next-object publisher loop advances through init and segments | Consecutive planned objects are committed into the live window. |
| `OBJ-FLOW-004` | S3 publisher keeps one-object context | Slot, grant, upload and commit context stay tied to the same object key. |
| `OBJ-FLOW-005` | Reconciliation plans in-flight S3 slots | Recovery jobs receive exact slot and object keys. |
| `OBJ-FLOW-006` | S3 publisher derives the next object from cursor cadence | The next planned object follows the trusted live cursor. |
| `OBJ-FLOW-007` | S3 publisher retry loop sees explicit failure state | Failed issue or upload attempts do not hide retry decisions. |
| `OBJ-FLOW-008` | S3 reconciliation commits existing objects | Failed slots are reported without stopping the batch. |
| `OBJ-FLOW-009` | S3 upload failure stops before commit | Planned context is returned and the cursor does not advance. |
| `OBJ-FLOW-010` | S3 retention deletes retired objects | Failed deletes are reported without changing cursor state. |
| `OBJ-FLOW-011` | Direct-public nonce-bearing object is committed | Official HLS output includes the coordinator-planned nonce-bearing delivery URL. |
| `OBJ-FLOW-012` | S3 publisher refreshes liveness before grant issuance | Failed heartbeat stops before an upload grant is issued. |
| `OBJ-FLOW-013` | Multiple S3 renditions are published | Master and media playlists stay coherent across renditions. |
| `OBJ-RUNTIME-001` | S3 runtime delegates base routes and grants | S3 HTTP handler serves runtime routes and issues upload grants. |
| `OBJ-RUNTIME-002` | S3 runtime returns route errors | S3 route failures are structured and do not swallow base runtime routes. |
| `OBJ-RUNTIME-003` | S3 runtime validates slot payload paths | Unsafe object paths are rejected before grant issuance. |
| `OBJ-RUNTIME-004` | S3 runtime validates slot payload identifiers | Unsafe IDs are rejected before coordinator mutation. |
| `OBJ-RUNTIME-005` | S3 runtime validates slot numeric fields | Invalid sizes, durations or sequence values are rejected. |
| `OBJ-RUNTIME-006` | S3 runtime validates publication modes | Unknown publication modes are rejected. |
| `OBJ-RUNTIME-007` | S3 runtime validates media object kinds | Unknown media object kinds are rejected. |
| `OBJ-RUNTIME-008` | S3 HTTP pipeline publishes live HLS | Fetch handler issues grants, commits uploads and serves manifests. |
| `OBJ-RUNTIME-009` | S3 HTTP pipeline commits provider events | Object-created events can advance stored HLS state through the handler. |
| `OBJ-RUNTIME-010` | S3 runtime request contains unsafe protocol identifiers | Slot grant, commit or reconciliation request is rejected before provider or coordinator mutation. |
| `OBJ-RUNTIME-011` | S3 runtime route contains unsafe session identifier | Request is rejected before provider or coordinator mutation. |
| `OBJ-RUNTIME-012` | S3 runtime route contains malformed percent encoding | Request is rejected with a deterministic bad-request response. |
| `OBJ-RUNTIME-013` | S3 commit request contains unsafe object-key hint | Request is rejected before provider or coordinator mutation. |
| `OBJ-RUNTIME-014` | S3 runtime accepts completion-hint route | Fetch handler verifies the object and commits through the slot completion route. |

## 12. Cache and delivery assertions

| ID | Scenario | Expected result |
|---|---|---|
| `OBJ-CACHE-001` | Request future uncommitted object URL | Does not poison official playback; implementation either uses unguessable URLs, disables negative caching, or routes through safe blocking path. |
| `OBJ-CACHE-002` | Committed media response | Includes immutable cache headers appropriate for media object delivery. |
| `OBJ-CACHE-003` | Manifest response | Uses no-store or short TTL suitable for live state. |
| `OBJ-CACHE-004` | Media response served as top-level document | Blocked or served with safe media-only headers. |
| `OBJ-CACHE-005` | Unknown extension under media prefix | Rejected or blocked by delivery policy. |

## 13. HLS golden-output assertions

| ID | Scenario | Expected result |
|---|---|---|
| `HLS-GOLDEN-001` | Render master playlist from one video rendition | Output exactly matches golden master playlist. |
| `HLS-GOLDEN-002` | Render media playlist from sample CommittedWindow | Output exactly matches golden LL-HLS playlist. |
| `HLS-GOLDEN-003` | Render partial live-edge segment | Output includes `EXT-X-PART` entries in committed order. |
| `HLS-GOLDEN-004` | Render completed historical segment | Output includes `EXTINF` and segment URI. |
| `HLS-GOLDEN-005` | Render independent part | Output includes `INDEPENDENT=YES`. |
| `HLS-GOLDEN-006` | Render discontinuity | Output includes `EXT-X-DISCONTINUITY`. |
| `HLS-GOLDEN-007` | Preload hints disabled | Output contains no `EXT-X-PRELOAD-HINT` by default. |
| `HLS-GOLDEN-008` | Publisher-supplied absolute URI appears in commit metadata | Gateway rejects or sanitises; output contains no unapproved authority. |
| `HLS-GOLDEN-009` | Content steering not configured | Output contains no `EXT-X-CONTENT-STEERING` by default. |
| `HLS-GOLDEN-010` | Rendition reports not configured | Output contains no `EXT-X-RENDITION-REPORT` by default. |
| `HLS-HOLDBACK-001` | Explicit hold-back values are configured | Server-control hold-back values are emitted only when valid for the target durations. |
| `HLS-BLOCK-001` | Blocking reload query is evaluated against the cursor | Requests already covered by the cursor resolve immediately; future requests wait. |
| `HLS-BLOCK-002` | Manifest artifacts resolve blocking media playlist requests | Blocking playlist responses wait for cursor advancement or return the current playlist on timeout. |
| `HLS-BLOCK-003` | Runtime client uses blocking playlist reloads | Client-visible playlist reloads unblock after the requested cursor position is committed. |

Golden outputs MUST be byte-for-byte stable after normalising line endings to `\n`.

## 14. Security-negative assertions

| ID | Scenario | Expected result |
|---|---|---|
| `SEC-DIRECT-001` | Publisher uploads object and shares direct URL before commit | Spec acknowledges possible direct readability; official manifests still omit object. |
| `SEC-DIRECT-002` | Publisher uploads `.html` or unknown extension through media slot | Upload grant or coordinator rejects; object is not committed. |
| `SEC-DIRECT-003` | Publisher attempts playlist upload | Rejected or ignored; manifest gateway never serves it as canonical. |
| `SEC-DIRECT-004` | Publisher submits absolute media URL in completion hint | Rejected; delivery URL is derived from coordinator/provider state. |
| `SEC-DIRECT-005` | Publisher attempts path traversal key | Rejected before upload grant. |
| `SEC-DIRECT-006` | Oversized object uploaded | Not committed; quota/audit event emitted. |
| `SEC-DIRECT-007` | Kill switch activated | New slots are not issued; cursor stops advancing; manifests stop exposing new media. |

## 15. Required fixtures

A conformance suite SHOULD include:

```text
valid session fixture
valid upload slot fixture
valid commit fixture
valid cursor with CommittedWindow fixture
invalid cursor without CommittedWindow fixture
valid single-rendition HLS golden output
invalid non-monotonic committed window
invalid duplicate commit
invalid wrong-key event
invalid oversized event
cache-header expected responses
security-negative hostile-publisher cases
```

## 15. Interoperability target

A complete v0.1.2 demonstration SHOULD prove:

```text
one publisher can upload through OLOS APIs
one coordinator can commit slots and produce a CommittedWindow
one gateway can generate deterministic LL-HLS from that CommittedWindow
one S3-compatible object binding can deliver media
another provider binding can implement the same core object model later
security-negative tests pass without media byte scanning
```
