# 6. HTTP API

This section defines the OLOS coordination HTTP API:

- the routes a coordinator MUST expose.
- the request payloads it MUST accept.
- the success responses it MUST return.
- the error envelope every non-success response MUST carry.

Payload field types reference the Appendix A schema names (for example
"OLOS Session"). Sections 3 through 5 define the underlying state
semantics.

Reference implementation (informative): the stored coordinator runtime
handler `olos/src/runtime/http.ts` and the S3 runtime handler that wraps
it, `olos/src/s3/http.ts`.

<!-- olos-conformance: 6 CORE-RUNTIME-001 CORE-RUNTIME-002 CORE-RUNTIME-003 CORE-RUNTIME-004 CORE-RUNTIME-005 CORE-RUNTIME-017 -->

## 6.1 Path roots and route table

A coordinator serves two path roots:

- the **session root**, default `/sessions`, for coordination commands.
- the **live root**, default `/v1/live`, for HLS playlist delivery.
  Live routes are served only for sessions that use the CMAF/LL-HLS
  profile (Section 6.7).

Both roots are deployment-configurable. A configured root MUST be an
absolute path without query, fragment, control characters, `.` or `..`
segments, and without a doubled leading slash. The tables below use the
default roots. `:id`, `:trackId`, and `:slotId` are URL-encoded
identifiers.

Core coordination routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/sessions` | Create a coordinator session. |
| `POST` | `/sessions/:id/slots` | Issue an upload slot. |
| `POST` | `/sessions/:id/commits` | Commit an observed upload. |
| `POST` | `/sessions/:id/transition` | Transition session state. |
| `POST` | `/sessions/:id/heartbeat` | Refresh a publisher lease. |
| `GET` | `/sessions/:id/retention` | Plan retention (read-only). |
| `GET` | `/sessions/:id/health` | Report live pipeline health. |
| `GET` | `/v1/live/:id/master.m3u8` | Master playlist. |
| `GET` | `/v1/live/:id/:trackId/media.m3u8` | Media playlist. |

Coordinators that bind an S3-compatible provider (see Section 7) also
serve the storage-binding (S3 profile) routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/sessions/:id/s3/slots` | Issue slot plus presigned grant. |
| `POST` | `/sessions/:id/s3/commits` | Observe and commit an upload. |
| `POST` | `/sessions/:id/s3/events` | Ingest object-created events. |
| `POST` | `/sessions/:id/s3/reconcile-plan` | List in-flight slots. |
| `POST` | `/sessions/:id/s3/reconcile` | Recover missed uploads. |
| `POST` | `/sessions/:id/s3/retention` | Prune state, delete objects. |
| `POST` | `/sessions/:id/upload-slots/:slotId/complete` | Completion hint. |

## 6.2 Common request handling

A coordinator dispatches requests by the longest matching root, then by
path segment. The following rules apply to every route:

- Route identifiers (`:id`, `:trackId`, `:slotId`) MUST be non-empty
  URL-safe identifiers after percent-decoding (see Section 1). If an
  identifier is not valid, the coordinator MUST reject the path with
  `400` and code `olos.invalid_request`.
- If a path contains invalid percent encoding, the coordinator MUST
  reject it with `400` and code `olos.invalid_request`.
- If a path under a served root matches no route, the coordinator MUST
  return `404` with code `olos.not_found`.
- If a matched session action receives an unsupported method, the
  coordinator MUST return `405` with code `olos.method_not_allowed`.
  An unknown action name for the request's method counts as an
  unsupported method. S3-binding routes accept only `POST`. Any other
  method on a matched S3 path MUST produce `405`.
- The session root (`/sessions`) accepts only `POST`. Any other method
  on it MUST produce `405` with code `olos.method_not_allowed` and an
  `Allow: POST` response header, not `404`.
- Request bodies are JSON. If a body is not a JSON object, or if its
  fields fail validation, the coordinator MUST reject it with `400`
  and code `olos.invalid_request`. The `message` SHOULD identify the
  offending field.
- Request bodies are size-bounded. The bound is
  deployment-configurable. The default bound is 1 MiB. The
  coordinator MUST reject a larger body with `413` and code
  `olos.invalid_request` before it parses the body.

Timestamps are RFC 3339 strings (Section 1.2). Identifiers are URL-safe identifiers.
Object keys MUST satisfy the path-safety rules of Section 7.5.

## 6.3 Error envelope

<!-- olos-conformance: 6.3 CORE-RUNTIME-025 -->

Every error response (any status other than the route's documented
success statuses) MUST have content type `application/json`. It MUST
carry the OLOS error envelope ("OLOS Error", Appendix A):

```json
{
  "error": {
    "code": "olos.object_too_large",
    "message": "object exceeds slot limit",
    "details": { "slotId": "slot_42", "maxBytes": 500000, "size": 700001 }
  }
}
```

- `error.code` is REQUIRED and MUST be one of the registered codes in
  Section 6.3.1. Consumers MUST tolerate unknown codes (Section 11.3).
- `error.message` is REQUIRED human-readable prose. It is diagnostic
  only. Clients MUST NOT branch on it.
- `error.details` is OPTIONAL. When present, it is a JSON object of
  machine-readable context (slot ids, limits, observed values). Servers
  SHOULD include the identifiers that correlate the rejection.

### 6.3.1 Error code registry

Domain codes describe protocol-level rejections. Transport codes map
HTTP-level failures.

| Code | Produced when | HTTP status |
| --- | --- | --- |
| `olos.invalid_session` | The referenced coordinator session does not exist (all stored routes). | 404 |
| `olos.unknown_slot` | A commit, completion hint, event, or revocation references a `slotId` or object key with no matching slot. | 404 |
| `olos.invalid_state` | A state-machine precondition fails (illegal session transition, heartbeat against an `ended` or `aborted` session, commit against an aborted session, commit without object proof (Section 4.4), commit behind the live cursor, object slot-metadata mismatch, revocation of a cursor-visible slot, malformed provider event record). | 409 |
| `olos.slot_expired` | The upload was observed after the slot's `expiresAt` plus the configured late tolerance (Section 4.5.3). Slots that expire without an upload are retired by retention (Section 9), and later commits answer `olos.unknown_slot`. | 409 |
| `olos.key_mismatch` | The observed object key differs from the slot's derived key, or completion-hint and observed evidence disagree on the key. | 409 |
| `olos.content_type_mismatch` | The observed object's content type differs from the slot's bound content type. | 409 |
| `olos.object_too_large` | Observed size exceeds `uploadSlot.maxBytes`. S3-binding rejections also attach an `auditEvent` (Section 6.6.3). | 409 |
| `olos.object_too_small` | Observed size is below `uploadSlot.minBytes`. | 409 |
| `olos.duplicate_commit_conflict` | A second commit for the same slot is not byte-for-byte idempotent with the recorded commit. | 409 |
| `olos.cursor_regression` | A cursor update attempts to move the published window backwards (Section 5). | 409 |
| `olos.provider_unavailable` | Reserved for provider outage reporting. Application commit policies or storage adapters emit it. | 409 |
| `olos.quota_exceeded` | An application-supplied commit policy rejects the commit for quota reasons. The coordinator propagates the policy's error unchanged. | 409 |
| `olos.security_policy_violation` | Publication control (kill switch, Section 10.5) disables the requested operation. | 409 |
| `olos.invalid_request` | A path, an identifier, a query parameter, or a request body fails validation. | 400, or `413` for an oversized request body (Section 6.2). |
| `olos.not_found` | A path under a served root matches no route. | 404 |
| `olos.method_not_allowed` | A matched path receives an unsupported method. | 405 |
| `olos.conflict` | Optimistic concurrency fails (Section 6.8), or a session already exists. | 409 |
| `olos.internal` | An unhandled error in any route. | 500 |

An unhandled error in any route maps to `500` with code
`olos.internal` (Section 3.10). The envelope carries a fixed message
that never holds internal error detail.

## 6.4 Session routes

<!-- olos-conformance: 6.4 CORE-RUNTIME-016 -->

### 6.4.1 Create session (`POST /sessions`)

Request body: a JSON object with

- `session` (REQUIRED): an "OLOS Session" document (Appendix A). It
  carries `profile`, a JSON object with a non-empty string `id`. It
  also carries `tracks`, a non-empty array of
  `{ trackId, contentType?, profile? }` with distinct `trackId`
  values. The Core route validates only the Core shape. It does not validate the contents of `session.profile`
  or `tracks[].profile`. The named profile defines them (Section 8 for
  `cmaf-llhls`).
- `deliveryBaseUrl` (REQUIRED): the absolute HTTP(S) base URL. The
  coordinator derives delivery URLs from it (Section 7.5).

Success: `201` with body `{ "sessionId": "<id>" }`.

Errors: `400 olos.invalid_request` for malformed payloads.
`409 olos.conflict` when a session with the same `sessionId` already
exists. Creation is not idempotent (see Section 6.8).

### 6.4.2 Transition session (`POST /sessions/:id/transition`)

Request body: `{ "state": "<SessionState>" }`, where the value MUST be
a session state from Section 4. Unknown values are `400`.

Success: `200` with `{ "sessionId", "state" }`.

Errors: `404 olos.invalid_session` for an unknown session.
`409 olos.invalid_state` when the session lifecycle (Section 4) does
not allow the transition. `409 olos.conflict` on store contention.

### 6.4.3 Publisher heartbeat (`POST /sessions/:id/heartbeat`)

<!-- olos-conformance: 6.4.3 CORE-RUNTIME-008 -->

Request body: `{ "publisherInstanceId": "<id>" }`.

The coordinator creates or refreshes the publisher lease for that
instance with the configured lease TTL. The coordinator MUST NOT
delete the leases of other instances. Success: `200` with
`{ "lease": { ... } }` (publisher instance id, session id, and expiry
timestamps).

Errors: `404 olos.invalid_session` for an unknown session.
`409 olos.invalid_state` when the session is `ended` or `aborted`.
`400 olos.invalid_request` for a malformed body or identifier.

### 6.4.4 Health (`GET /sessions/:id/health`)

<!-- olos-conformance: 6.4.4 CORE-RUNTIME-011 -->

The optional query parameter `publisherInstanceId` restricts lease
reporting to one publisher instance. An invalid identifier is `400`.

Success: `200` with `{ "health": { ... } }`. The health document
reports cursor freshness against the configured maximum cursor age. It
also reports publisher lease freshness. The coordinator measures
freshness by cursor `updatedAt`. The default maximum cursor age is 5000 ms
(`targetLatency + segmentTarget`, Section 8.9.6). Deployments
with other profiles SHOULD configure their own bound. If a session has
no cursor yet, the coordinator reports it as starting. If a requested
publisher instance has no stored lease, the coordinator MUST report it
stale.

Errors: `404 olos.invalid_session`.

### 6.4.5 Retention plan (`GET /sessions/:id/retention`)

This route is read-only planning (see Section 9.2). The optional query
parameter `now` (RFC 3339) overrides the evaluation clock. Success:
`200` with `{ "plan": { expiredSlots, retiredObjects, cursor? } }`.
The plan identifies retired objects by track and sequence number. This
route MUST NOT mutate stored state.

## 6.5 Slot and commit routes

### 6.5.1 Issue slot (`POST /sessions/:id/slots`)

<!-- olos-conformance: 6.5.1 CORE-RUNTIME-020 -->

Request body fields (an issued slot is returned as "OLOS UploadSlot"):

| Field | Req | Meaning |
| --- | --- | --- |
| `slotId` | yes | URL-safe unique slot identifier. |
| `kind` | yes | `init`, `segment`, or `part`. |
| `trackId` | yes | Must belong to `session.tracks`. |
| `sequenceNumber` | yes | Non-negative integer. |
| `partNumber` | if `kind=part` | Non-negative integer. Forbidden otherwise. |
| `contentType` | yes | Content type the upload MUST use. |
| `profile` | no | JSON object, opaque to Core. The issuer's expectation for the object (Section 3). |
| `expiresAt` | yes | Slot expiry timestamp. |
| `maxBytes` | yes | Positive upper size bound. |
| `minBytes` | no | Non-negative lower size bound. |
| `extension` | no | Object-key extension, without a dot (Section 7.5). Omitted, the key has no extension. |
| `objectKeyNonce` | no | URL-safe nonce override (Section 7.6). |
| `objectKeyPrefix` | no | Safe path prefix override. |
| `byterange` | no | Parts only. Byterange-addressed part placement. |

The payload MUST NOT include `objectKey` or `deliveryUrl`. The
coordinator derives both (Section 7.5). If a payload contains either
field, the coordinator MUST reject it with `400`. Core treats
`profile` as an opaque JSON object (Section 2.1) and stores it on
`slot.profile` unchanged.

Success: `201` with `{ "slot": <OLOS UploadSlot> }`. The slot state is
`issued`. The fields `slot.objectKey` and `slot.deliveryUrl` carry the
derived addresses.

Errors: `400 olos.invalid_request` (malformed payload, duplicate
`slotId`, unknown track, session not `live`).
`404 olos.invalid_session` for an unknown session.
`409 olos.security_policy_violation` when publication control disables
slot issuance. `409 olos.conflict` on store contention.

### 6.5.2 Commit upload (`POST /sessions/:id/commits`)

<!-- olos-conformance: 6.5.2 CORE-RUNTIME-021 -->

Request body:

| Field | Req | Meaning |
| --- | --- | --- |
| `commitId` | yes | Idempotency key for this commit. |
| `slotId` | yes | Slot being committed. |
| `committedAt` | yes | Commit timestamp. |
| `object` | yes | Observed-upload evidence (below). |
| `profile` | no | JSON object, opaque to Core. Profile-defined facts about the object. |
| `lateToleranceMs` | no | Per-commit late tolerance override. |
| `maxSegments` | no | Retained-window bound (Section 5). |

`object` fields: `contentType`, `objectKey`, `observedAt`,
`providerId`, `size` (all REQUIRED), `etag` and `metadata` (OPTIONAL).
`object.size` MUST be positive. `object.objectKey` MUST be a safe
object key.

The recorded `commit.profile` is the slot profile merged with the
request profile, as Section 4.5.1 defines. Idempotency (Section 6.8)
compares `profile` structurally.

Success: `201` with `{ "commit": <OLOS Commit>, "cursor"?: <OLOS
Cursor> }` for a newly recorded commit. The response is `200` with the
same shape when the request is idempotent with an existing commit.
`cursor` is present whenever the session has a cursor after the
commit.

Errors: `400` for malformed payloads. `404 olos.invalid_session` or
`404 olos.unknown_slot`. `409` with `olos.key_mismatch`,
`olos.content_type_mismatch`, `olos.object_too_large`,
`olos.object_too_small`, `olos.duplicate_commit_conflict`,
`olos.invalid_state` (aborted session, no object proof, object
behind the live cursor), `olos.security_policy_violation`, or a
commit-policy code
(for example `olos.quota_exceeded`). `409 olos.conflict` on
contention.

A successful commit MUST wake any blocking playlist reloads that wait
on the advanced cursor (Section 8.7). A rejected commit MUST NOT wake
them.

## 6.6 S3-binding routes

<!-- olos-conformance: 6.6 OBJ-RUNTIME-001 OBJ-RUNTIME-002 OBJ-RUNTIME-003 OBJ-RUNTIME-004 OBJ-RUNTIME-005 OBJ-RUNTIME-006 OBJ-RUNTIME-007 OBJ-RUNTIME-010 OBJ-RUNTIME-011 OBJ-RUNTIME-012 OBJ-RUNTIME-013 -->

These routes are the S3-compatible implementation (Appendix C) of the
storage binding contract (Section 7). S3-binding routes extend the core
routes. Requests that do not match an S3 path fall through to the core
handler unchanged. All S3 routes are `POST` and share the validation
rules of Section 6.2.

### 6.6.1 Issue upload grant (`POST /sessions/:id/s3/slots`)

Request body: identical to Section 6.5.1. Success: `201` with
`{ "grant": <OLOS UploadGrant>, "slot": <OLOS UploadSlot> }`. The
grant is a presigned exact-key `PUT` (Section 7.2, Appendix C).
Errors: as in Section 6.5.1.

### 6.6.2 Commit upload (`POST /sessions/:id/s3/commits`)

Request body: as Section 6.5.2 minus the `object` field, plus:

- `providerId` (REQUIRED unless configured server-side): the provider
  that issues the observation.
- `objectKey` (OPTIONAL): the expected key. When present, it MUST
  match the slot's derived key. If it does not match, the coordinator
  rejects the request with `409 olos.key_mismatch`.
- `versionId` (OPTIONAL): the provider object version to observe.

Before it commits, the coordinator observes the object against the
slot's derived key (observation, Section 7.3, `HeadObject` under
Appendix C). The publisher never supplies size or content type on this
route.

Success and errors: as Section 6.5.2.

### 6.6.3 Completion hint (`POST /sessions/:id/upload-slots/:slotId/complete`)

This route is a publisher-side hint that the upload for `:slotId`
finished. Publishers use it when they do not wait for provider events.
The body is as Section 6.6.2 with these differences:

- `slotId` comes from the path. The coordinator ignores a body
  `slotId`.
- `commitId` defaults to `complete_<slotId>` when omitted.
- `committedAt` defaults to the coordinator's current time.
- `etag` and `size` MUST NOT be present. Observation (Section 7.3,
  `HeadObject` under Appendix C) is the only source of truth for
  observed object metadata. Requests that carry either field are
  `400`.
- `deliveryUrl` MUST NOT be present. Requests that carry it are `400`.

Success and errors: as Section 6.6.2. When the coordinator rejects an
oversized upload on an S3 commit or completion-hint route, it adds a
sibling `auditEvent` object to the error envelope. The object carries
`eventType: "upload.rejected"`, `reason: "object_too_large"`,
`maxBytes`, `observedBytes`, `objectKey`, `slotId`, and `occurredAt`.
Deployments can then alert on abuse without message parsing.

### 6.6.4 Provider events (`POST /sessions/:id/s3/events`)

Request body: an S3 event notification document (`{ "Records": [...] }`,
Section 7.4). The route REQUIRES a server-side configured `providerId`.
Without one, the request is `400`.

The coordinator normalizes and routes each record independently.
Success: `202` with `{ "results": [ ... ] }`, one entry per record:

- `{ "status": "committed" | "idempotent", "commit": ... }`
- `{ "status": "invalid_event", "error": { code, message, ... } }`
- `{ "status": "rejected", "error": { ... }, ... }`
- `{ "status": "conflict" }` or `{ "status": "not_found" }`

The route returns `202` even when individual records fail. Per-record
errors carry registered error codes. If a record names a bucket other
than the configured bucket, the coordinator MUST report it
`invalid_event` and not apply it.

### 6.6.5 Reconciliation (`reconcile-plan` and `reconcile`)

Section 9.4 defines the semantics of both routes.
`POST /sessions/:id/s3/reconcile-plan` returns `200` with the plan.
`POST /sessions/:id/s3/reconcile` returns `202` with the results and
the summary. Both routes answer `404 olos.invalid_session` for an
unknown session.

### 6.6.6 Retention (`POST /sessions/:id/s3/retention`)

Request body: `{ "now": "<timestamp>" }` (REQUIRED). The route applies
retention and then deletes retired objects (see Section 9.3). Success:
`202` with `{ "plan", "result", "summary" }`. Errors:
`404 olos.invalid_session`, `409 olos.conflict`, and `400` for a
missing or invalid `now`.

## 6.7 Live playlist routes

<!-- olos-conformance: 6.7 CORE-RUNTIME-022 CORE-RUNTIME-023 CORE-RUNTIME-024 -->

`GET /v1/live/:id/master.m3u8` and
`GET /v1/live/:id/:trackId/media.m3u8` serve the playlists defined in
Section 8 with content type `application/vnd.apple.mpegurl` and the
cache policy of Section 10.4. Only `GET` is allowed (`405` otherwise).
An unknown session is `404`.

Playlists exist only for sessions whose `session.profile.id` is
`cmaf-llhls`. For any other profile, the coordinator MUST answer `400`
with the JSON envelope and code `olos.invalid_request`. The message
starts with `HLS playlists are only served for cmaf-llhls sessions`.
The same rejection applies when the session or track `profile` fails
the CMAF/LL-HLS profile validation (Appendix A.2). The coordinator
applies this rule after it loads the session and before it renders.

A session without a cursor has no playlists yet and is `404`. A track
with no committed objects has no media playlist yet. Its route is
`404` and the master does not advertise it. A session whose committed
window contains no video track has no master playlist yet and is also
`404` (Section 8.2).

Media playlist requests MAY carry the LL-HLS blocking reload query
parameters `_HLS_msn` and `_HLS_part`, which Section 8.7 defines. If a
request carries `_HLS_part` without `_HLS_msn`, or a non-integer
value, the coordinator MUST reject it with `400`.

The coordinator serves playlist-rendering errors (missing cursor,
missing track, no master) as `text/plain` bodies. Routing errors (bad
identifier, unknown session, wrong method, and the profile rejection
above) use the JSON envelope of Section 6.3.

## 6.8 Optimistic concurrency

Stored coordinator state is versioned with an entity tag (etag). Every
mutating route MUST apply its mutation with compare-and-swap
semantics: load the snapshot, mutate, and save-if-unchanged. The route
retries up to a configured attempt bound. If the attempts are
exhausted, or if the route detects a non-retryable concurrent change,
the route MUST respond `409 olos.conflict`. If the session already
exists, session creation responds `409 olos.conflict`.

The `409` body for the losing writer is the plain error envelope.
Idempotent replays (a duplicate commit with identical content) are not
conflicts. They return `200` without a write.
