# 6. HTTP API

This section defines the OLOS coordination HTTP API: the routes a
coordinator MUST expose, the request payloads it MUST accept, the
success responses it MUST return, and the error envelope every
non-success response MUST carry. Payload field types reference the
Appendix A schema names (for example "OLOS Session"); the underlying
state semantics are defined in Sections 3 through 5.

The normative reference for this section is the stored coordinator
runtime handler (`olos/src/runtime/http.ts`) and the S3 runtime handler
that wraps it (`olos/src/s3/http.ts`).

<!-- olos-conformance: 6 CORE-RUNTIME-001 CORE-RUNTIME-002 CORE-RUNTIME-003 CORE-RUNTIME-004 CORE-RUNTIME-005 CORE-RUNTIME-017 -->

## 6.1 Path roots and route table

A coordinator serves two path roots:

- the **session root**, default `/sessions`, for coordination commands;
- the **live root**, default `/v1/live`, for HLS playlist delivery.

Both roots are deployment-configurable. A configured root MUST be an
absolute path without query, fragment, control characters, `.` or `..`
segments, and without a doubled leading slash. The tables below use the
defaults; `:id`, `:rid`, and `:slotId` are URL-encoded identifiers.

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
| `GET` | `/v1/live/:id/:rid/media.m3u8` | Media playlist. |

Storage-binding (S3 profile) routes, served by coordinators that bind
an S3-compatible provider (see Section 7):

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/sessions/:id/s3/slots` | Issue slot plus presigned grant. |
| `POST` | `/sessions/:id/s3/commits` | Verify and commit an upload. |
| `POST` | `/sessions/:id/s3/events` | Ingest object-created events. |
| `POST` | `/sessions/:id/s3/reconcile-plan` | List in-flight slots. |
| `POST` | `/sessions/:id/s3/reconcile` | Recover missed uploads. |
| `POST` | `/sessions/:id/s3/retention` | Prune state, delete objects. |
| `POST` | `/sessions/:id/upload-slots/:slotId/complete` | Completion hint. |

Note: the completion-hint route sits directly under the session root
(`upload-slots` segment) rather than under the `/s3/` segment. This is
the wire path produced and matched by the reference implementation
(`olos/src/s3/route.ts`, `olos/src/s3/http-route.ts`).

## 6.2 Common request handling

Requests are dispatched by longest matching root, then by path segment.
The following rules apply to every route:

- Route identifiers (`:id`, `:rid`, `:slotId`) MUST be non-empty
  URL-safe identifiers after percent-decoding (see Section 1). A path
  whose identifier fails this check MUST be rejected with `400` and
  code `olos.invalid_request`.
- A path containing invalid percent encoding MUST be rejected with
  `400` and code `olos.invalid_request`.
- A path under a served root that matches no route MUST produce `404`
  with code `olos.not_found`.
- A matched session action with an unsupported method — including an
  unknown action name for the request's method — MUST produce `405`
  with code `olos.method_not_allowed`. S3-binding routes accept only
  `POST`; any other method on a matched S3 path MUST produce `405`.
- Request bodies are JSON. A body that is not a JSON object, or whose
  fields fail validation, MUST be rejected with `400` and code
  `olos.invalid_request`; the `message` SHOULD identify the offending
  field.

Timestamps are ISO 8601 strings; identifiers are URL-safe identifiers;
object keys MUST satisfy the path-safety rules of Section 7.5.

## 6.3 Error envelope

<!-- olos-conformance: 6.3 CORE-RUNTIME-025 -->

Every error response — any status other than the route's documented
success statuses — MUST have content type `application/json` and MUST
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
  only; clients MUST NOT branch on it.
- `error.details` is OPTIONAL. When present it is a JSON object of
  machine-readable context (slot ids, limits, observed values). Servers
  SHOULD include the identifiers needed to correlate the rejection.

### 6.3.1 Error code registry

Thirteen domain codes describe protocol-level rejections:

| Code | Produced when |
| --- | --- |
| `olos.invalid_session` | The referenced coordinator session does not exist (all stored routes; HTTP 404). |
| `olos.invalid_state` | A state-machine precondition fails: illegal session transition, heartbeat against an `ended`/`aborted` session, commit against an aborted session, commit of an unverified object, commit behind the live cursor, object slot-metadata mismatch, revocation of a cursor-visible slot, or a malformed provider event record. |
| `olos.unknown_slot` | A commit, completion hint, event, or revocation references a `slotId` or object key with no matching slot (HTTP 404). |
| `olos.slot_expired` | Reserved: rejection of an upload against an expired slot. The reference implementation currently retires expired slots via retention (Section 9) instead of emitting this code. |
| `olos.key_mismatch` | The observed object key differs from the slot's derived key, or completion-hint and observed evidence disagree on the key. |
| `olos.content_type_mismatch` | The observed object's content type differs from the slot's bound content type. |
| `olos.object_too_large` | Observed size exceeds `uploadSlot.maxBytes`. S3-binding rejections additionally attach an `auditEvent` (Section 6.6.3). |
| `olos.object_too_small` | Observed size is below `uploadSlot.minBytes`. |
| `olos.duplicate_commit_conflict` | A second commit for the same slot is not byte-for-byte idempotent with the recorded commit. |
| `olos.cursor_regression` | A cursor update would move the published window backwards (Section 5). |
| `olos.provider_unavailable` | Reserved for provider outage reporting. Emitted by application commit policies or storage adapters; the core runtime has no built-in producer. |
| `olos.quota_exceeded` | An application-supplied commit policy rejects the commit for quota reasons; the coordinator propagates the policy's error unchanged. |
| `olos.security_policy_violation` | Publication control (kill switch, Section 10.5) has disabled the requested operation. |

Four transport codes map HTTP-level failures:

| Code | HTTP status |
| --- | --- |
| `olos.invalid_request` | 400 |
| `olos.not_found` | 404 |
| `olos.method_not_allowed` | 405 |
| `olos.conflict` | 409 |

### 6.3.2 Status mapping for domain rejections

A domain rejection MUST map to HTTP status as follows:

- `olos.unknown_slot` maps to `404`.
- Every other domain code carried on a rejection maps to `409`,
  except `olos.invalid_session`, which maps to `404` when it reports a
  missing session.

## 6.4 Session routes

<!-- olos-conformance: 6.4 CORE-RUNTIME-016 -->

### 6.4.1 Create session — `POST /sessions`

Request body: a JSON object with

- `session` (REQUIRED): an "OLOS Session" document (Appendix A).
- `mediaBaseUrl` (REQUIRED): absolute HTTP(S) base URL from which
  delivery URLs are derived (Section 7.5).

Success: `201` with body `{ "sessionId": "<id>" }`.

Errors: `400 olos.invalid_request` for malformed payloads;
`409 olos.conflict` when a session with the same `sessionId` already
exists (creation is not idempotent; see Section 6.8).

### 6.4.2 Transition session — `POST /sessions/:id/transition`

Request body: `{ "state": "<SessionState>" }`, where the value MUST be
a session state from Section 4. Unknown values are `400`.

Success: `200` with `{ "sessionId", "state" }`.

Errors: `404 olos.invalid_session`; `409 olos.invalid_state` when the
transition is not allowed by the session lifecycle (Section 4);
`409 olos.conflict` on store contention.

### 6.4.3 Publisher heartbeat — `POST /sessions/:id/heartbeat`

<!-- olos-conformance: 6.4.3 CORE-RUNTIME-008 -->

Request body: `{ "publisherInstanceId": "<id>" }`.

The coordinator creates or refreshes the publisher lease for that
instance with the configured lease TTL and MUST NOT drop other
instances' leases. Success: `200` with `{ "lease": { ... } }`
(publisher instance id, session id, and expiry timestamps).

Errors: `404 olos.invalid_session`; `409 olos.invalid_state` when the
session is `ended` or `aborted`; `400 olos.invalid_request` for a
malformed body or identifier.

### 6.4.4 Health — `GET /sessions/:id/health`

<!-- olos-conformance: 6.4.4 CORE-RUNTIME-011 -->

Optional query parameter `publisherInstanceId` restricts lease checks
to one publisher instance; an invalid identifier is `400`.

Success: `200` with `{ "health": { ... } }` reporting cursor freshness
against the configured maximum cursor age (default: the object
low-latency profile's `cursorMaxAgeMs`) and publisher lease freshness.
A session with no cursor yet is reported as starting, not stale. A
requested publisher instance without a stored lease MUST be reported
stale.

Errors: `404 olos.invalid_session`.

### 6.4.5 Retention plan — `GET /sessions/:id/retention`

Read-only planning; see Section 9.2. Accepts optional query parameter
`now` (ISO 8601) overriding the evaluation clock. Success: `200` with
`{ "plan": { expiredSlots, retiredObjects, cursor? } }`. This route
MUST NOT mutate stored state.

## 6.5 Slot and commit routes

### 6.5.1 Issue slot — `POST /sessions/:id/slots`

<!-- olos-conformance: 6.5.1 CORE-RUNTIME-020 -->

Request body fields (an issued slot is returned as "OLOS UploadSlot"):

| Field | Req | Meaning |
| --- | --- | --- |
| `slotId` | yes | URL-safe unique slot identifier. |
| `kind` | yes | `init`, `segment`, or `part`. |
| `renditionId` | yes | Must belong to `session.renditions`. |
| `mediaSequenceNumber` | yes | Non-negative integer. |
| `partNumber` | iff `kind=part` | Non-negative integer; forbidden otherwise. |
| `contentType` | yes | Content type the upload MUST use. |
| `duration` | yes | Positive seconds. |
| `expiresAt` | yes | Slot expiry timestamp. |
| `maxBytes` | yes | Positive upper size bound. |
| `minBytes` | no | Non-negative lower size bound. |
| `extension` | no | Object-key extension override (Section 7.5). |
| `objectKeyNonce` | no | URL-safe nonce override (Section 7.6). |
| `objectKeyPrefix` | no | Safe path prefix override. |
| `byterange` | no | Parts only; byterange-addressed part placement. |

The payload MUST NOT include `objectKey` or `deliveryUrl`: the
coordinator derives both (Section 7.5). A payload containing either
field MUST be rejected with `400`.

Success: `201` with `{ "slot": <OLOS UploadSlot> }`. The slot state is
`issued` and `slot.objectKey`/`slot.deliveryUrl` carry the derived
addresses.

Errors: `400 olos.invalid_request` (malformed payload, duplicate
`slotId`, unknown rendition, session not `live`);
`404 olos.invalid_session`; `409 olos.security_policy_violation` when
slot issuance is disabled by publication control; `409 olos.conflict`
on store contention.

### 6.5.2 Commit upload — `POST /sessions/:id/commits`

<!-- olos-conformance: 6.5.2 CORE-RUNTIME-021 -->

Request body:

| Field | Req | Meaning |
| --- | --- | --- |
| `commitId` | yes | Idempotency key for this commit. |
| `slotId` | yes | Slot being committed. |
| `committedAt` | yes | Commit timestamp. |
| `object` | yes | Observed-upload evidence (below). |
| `independent` | no | Marks a part as independently decodable. |
| `lateToleranceMs` | no | Per-commit late tolerance override. |
| `maxSegments` | no | Retained-window bound (Section 5). |
| `programDateTime` | no | Wall-clock timestamp for the segment. |

`object` fields: `contentType`, `objectKey`, `observedAt`,
`providerId`, `size` (all REQUIRED), `etag` and `metadata` (OPTIONAL).
`object.size` MUST be positive; `object.objectKey` MUST be a safe
object key.

Success: `201` with `{ "commit": <OLOS Commit>, "cursor"?: <OLOS
Cursor> }` for a newly recorded commit; `200` with the same shape when
the request is idempotent with an existing commit. `cursor` is present
whenever the session has a cursor after the commit.

Errors: `400` for malformed payloads; `404 olos.invalid_session`;
`404 olos.unknown_slot`; `409` with `olos.key_mismatch`,
`olos.content_type_mismatch`, `olos.object_too_large`,
`olos.object_too_small`, `olos.duplicate_commit_conflict`,
`olos.invalid_state` (aborted session, unverified object, late
object), `olos.security_policy_violation`, or a commit-policy code
(`olos.quota_exceeded`, etc.); `409 olos.conflict` on contention.

A successful commit MUST wake any blocking playlist reloads waiting on
the advanced cursor (Section 8.6); a rejected commit MUST NOT.

## 6.6 S3-binding routes

<!-- olos-conformance: 6.6 OBJ-RUNTIME-001 OBJ-RUNTIME-002 OBJ-RUNTIME-003 OBJ-RUNTIME-004 OBJ-RUNTIME-005 OBJ-RUNTIME-006 OBJ-RUNTIME-007 OBJ-RUNTIME-010 OBJ-RUNTIME-011 OBJ-RUNTIME-012 OBJ-RUNTIME-013 -->

S3-binding routes extend the core routes; requests that do not match an
S3 path fall through to the core handler unchanged. All S3 routes are
`POST` and share the validation rules of Section 6.2.

### 6.6.1 Issue upload grant — `POST /sessions/:id/s3/slots`

Request body: identical to Section 6.5.1. Success: `201` with
`{ "grant": <OLOS UploadGrant>, "slot": <OLOS UploadSlot> }`, where the
grant is a presigned exact-key `PUT` (Section 7.2). Errors: as in
Section 6.5.1.

### 6.6.2 Commit upload — `POST /sessions/:id/s3/commits`

Request body: as Section 6.5.2 minus the `object` field, plus:

- `providerId` (REQUIRED unless configured server-side): provider
  issuing the observation.
- `objectKey` (OPTIONAL): expected key; when present it MUST match the
  slot's derived key or the request is rejected with
  `409 olos.key_mismatch`.
- `versionId` (OPTIONAL): provider object version to verify.

The coordinator itself observes the object with a `HeadObject` against
the slot's derived key before committing (Section 7.3); the publisher
never supplies size or content type on this route.

Success and errors: as Section 6.5.2.

### 6.6.3 Completion hint — `POST /sessions/:id/upload-slots/:slotId/complete`

A publisher-side hint that the upload for `:slotId` finished, used
instead of waiting for provider events. The body is as Section 6.6.2
with these differences:

- `slotId` comes from the path; a body `slotId` is ignored.
- `commitId` defaults to `complete_<slotId>` when omitted.
- `committedAt` defaults to the coordinator's current time.
- `etag` and `size` MAY be present and are validated for shape only;
  authoritative values come from the coordinator's own observation.
- `deliveryUrl` MUST NOT be present; requests carrying it are `400`.

Success and errors: as Section 6.6.2. When an oversized upload is
rejected on an S3 commit or completion-hint route, the error envelope
is augmented with a sibling `auditEvent` object
(`eventType: "upload.rejected"`, `reason: "object_too_large"`,
`maxBytes`, `observedBytes`, `objectKey`, `slotId`, `occurredAt`) so
deployments can alert on abuse without parsing messages.

### 6.6.4 Provider events — `POST /sessions/:id/s3/events`

Request body: an S3 event notification document (`{ "Records": [...] }`,
Section 7.4). The route REQUIRES a server-side configured `providerId`;
without one it is `400`.

Each record is normalized and routed independently. Success: `202`
with `{ "results": [ ... ] }`, one entry per record:

- `{ "status": "committed" | "idempotent", "commit": ... }`
- `{ "status": "invalid_event", "error": { code, message, ... } }`
- `{ "status": "rejected", "error": { ... }, ... }`
- `{ "status": "conflict" }` or `{ "status": "not_found" }`

The route returns `202` even when individual records fail; per-record
errors carry registered error codes. Records for buckets other than
the configured bucket MUST be reported `invalid_event`, not applied.

### 6.6.5 Reconciliation — `reconcile-plan` and `reconcile`

See Section 9.4 for semantics. `POST /sessions/:id/s3/reconcile-plan`
takes `{ "slotIds"?: [...] }` and returns `200` with the plan.
`POST /sessions/:id/s3/reconcile` takes `{ "committedAt", "providerId"?,
"versionId"?, "slotIds"?, "independent"?, "lateToleranceMs"?,
"maxSegments"?, "programDateTime"? }` and returns `202` with
`{ "results", "summary" }`. Both are `404 olos.invalid_session` for
unknown sessions.

### 6.6.6 Retention — `POST /sessions/:id/s3/retention`

Request body: `{ "now": "<timestamp>" }` (REQUIRED). Applies retention
then deletes retired objects; see Section 9.3. Success: `202` with
`{ "plan", "result", "summary" }`. Errors: `404 olos.invalid_session`,
`409 olos.conflict`, `400` for a missing or invalid `now`.

## 6.7 Live playlist routes

<!-- olos-conformance: 6.7 CORE-RUNTIME-022 CORE-RUNTIME-023 CORE-RUNTIME-024 -->

`GET /v1/live/:id/master.m3u8` and
`GET /v1/live/:id/:rid/media.m3u8` serve the playlists defined in
Section 8 with content type `application/vnd.apple.mpegurl` and the
manifest cache policy of Section 10.4. Only `GET` is allowed (`405`
otherwise). Unknown sessions are `404`; a session without a cursor has
no playlists yet and is `404`.

Media playlist requests MAY carry the LL-HLS blocking reload query
parameters `_HLS_msn` and `_HLS_part`. When the coordinator has
blocking reload enabled, a request naming a position beyond the live
edge MUST be held until the cursor satisfies it or the configured
timeout elapses, then answered with the current playlist; `_HLS_part`
without `_HLS_msn`, or non-integer values, MUST be rejected with `400`.
Full blocking semantics, including unblocking conditions and timeout
behavior, are specified in Section 8.6. Playlist-route errors are
served as `text/plain` bodies, not JSON envelopes; they are delivery
artifacts, not coordination-API responses.

## 6.8 Optimistic concurrency

Stored coordinator state is versioned with an entity tag (etag). Every
mutating route MUST apply its mutation with compare-and-swap semantics:
load snapshot, mutate, save-if-unchanged, retrying up to a configured
attempt bound. When attempts are exhausted, or a non-retryable
concurrent change is detected, the route MUST respond
`409 olos.conflict`. Session creation responds `409 olos.conflict`
when the session already exists.

The losing writer's `409` body is the plain error envelope. The current
snapshot observed at conflict time is surfaced to the embedding
application through the handler result (for logging or merge logic); it
is not returned on the wire. Idempotent replays (duplicate commit with
identical content) are not conflicts: they return `200` without writing.
