# 3. Data model

This section defines every Core wire object normatively, field by field.
The machine-readable JSON Schemas in Appendix A.1 are generated from the
reference implementation (`olos/src/schema.ts`). Constraints that JSON
Schema 2020-12 cannot express (cross-field and cross-sibling rules) are
stated here in prose. These prose constraints are equally binding. The
contents of every `profile` field are defined by the session's profile,
not here; the CMAF/LL-HLS profile's contents are defined in Section 8 and
Appendix A.2.

## 3.1 Wire object conventions

<!-- olos-conformance: 3.1 CORE-SCHEMA-001 -->

- Every wire object is a JSON object. All objects are closed on the write
  path: the coordinator MUST reject unknown properties in inbound payloads
  and in stored documents it re-validates, while clients MUST ignore
  unknown fields in what they read (Section 1.2, Section 11.2).
- Field types follow the conventions of Section 1.2: RFC 3339 timestamps,
  URL-safe identifiers, and integer byte sizes.
- Every `profile` field is opaque profile data (Section 1.2). Core
  validators MUST require a JSON object and MUST NOT constrain its keys,
  except that `session.profile` and `cursor.profile` MUST carry a
  non-empty string `id`. Core MUST carry profile data unchanged between
  the objects that copy it (Section 2.1). Keys inside profile data are
  never unknown fields.
- Each object defined below has a published JSON Schema. An implementation
  MUST accept every payload that the schema plus the prose constraints
  accept. It MUST reject every payload that either rejects.

## 3.2 Session

A session declares one live stream and the profile it runs under.

| Field       | Req | Constraints                                          |
| ----------- | --- | ---------------------------------------------------- |
| `olos`      | yes | MUST be the wire version `"1.0"`.                    |
| `sessionId` | yes | URL-safe identifier.                                 |
| `epoch`     | yes | Non-negative integer.                                |
| `state`     | yes | One of `live`, `ending`, `ended`, `aborted`.         |
| `createdAt` | yes | RFC 3339 timestamp.                                  |
| `profile`   | yes | Session profile: JSON object whose `id` is a         |
|             |     | non-empty string naming the profile. All other keys  |
|             |     | are opaque to Core.                                  |
| `tracks`    | yes | Non-empty array of Track objects.                    |

`tracks` MUST NOT contain two entries with the same `trackId`. The
coordinator copies `profile` unchanged onto every cursor of the session
(Section 3.8). Core does not validate that `profile.id` names a profile
the implementation supports; the profile layer does (the CMAF/LL-HLS
profile's `id` is `cmaf-llhls`, Section 8).

### 3.2.1 Track

| Field         | Req | Constraints                                        |
| ------------- | --- | -------------------------------------------------- |
| `trackId`     | yes | URL-safe identifier, unique in the session.        |
| `contentType` | no  | Valid MIME content type. The default content type  |
|               |     | of the track's objects, when uniform.              |
| `profile`     | no  | Profile data describing the track (opaque to Core).|

Core identifies a track and nothing more. What a track carries (kind,
codec, bitrate, dimensions, frame rate, audio characteristics, audio-group
membership) is profile data. For the CMAF/LL-HLS profile these fields and
their cross-track constraints are defined in Section 8 and validated by
the profile module, not by Core.

Schema: see Appendix A, `OLOS_SESSION_SCHEMA`.

## 3.3 UploadSlot

An upload slot reserves exactly one object (Section 4.2).

| Field            | Req | Constraints                                     |
| ---------------- | --- | ----------------------------------------------- |
| `slotId`         | yes | URL-safe identifier, unique per session.        |
| `sessionId`      | yes | URL-safe identifier of the owning session.      |
| `trackId`        | yes | MUST name a track of the session.               |
| `epoch`          | yes | Non-negative integer. The session's epoch.      |
| `kind`           | yes | `init`, `part`, or `segment`.                   |
| `state`          | yes | One of `issued`, `upload_observed`,             |
|                  |     | `committed`, `expired`, `rejected`, `revoked`.  |
| `sequenceNumber` | yes | Non-negative integer.                           |
| `partNumber`     | no  | Non-negative integer. Part slots only.          |
| `objectKey`      | yes | Safe object key (Section 1.3).                  |
| `deliveryUrl`    | yes | Safe delivery URL (Section 1.3).                |
| `contentType`    | yes | Valid MIME content type.                        |
| `maxBytes`       | yes | Positive integer.                               |
| `minBytes`       | no  | Non-negative integer.                           |
| `expiresAt`      | yes | RFC 3339 timestamp.                             |
| `byterange`      | no  | Byterange object. `kind` MUST be `part`.        |
| `profile`        | no  | Profile data: the issuer's expectations for the |
|                  |     | object (opaque to Core).                        |

When both bounds are present, `minBytes` MUST be less than or equal to
`maxBytes`. This is a cross-field rule not expressed in the schema.

Core imposes no file-extension rule on `objectKey`; a key with no
extension is valid. A profile MAY require one (the CMAF/LL-HLS profile
requires `.mp4` for `init` and `.m4s` for `part` and `segment`, Section
8). The slot's `profile` is the starting point of the commit's `profile`
(Section 3.4). In the CMAF/LL-HLS profile it carries the object's expected
`duration`.

### 3.3.1 Byterange

A part slot or part commit MAY address its bytes as a range within a
virtual segment object instead of a standalone object:

| Field                | Req | Constraints                       |
| -------------------- | --- | --------------------------------- |
| `offset`             | yes | Non-negative integer (bytes).     |
| `length`             | yes | Positive integer (bytes).         |
| `segmentObjectKey`   | yes | Safe object key.                  |
| `segmentDeliveryUrl` | yes | Safe delivery URL.                |

A byterange MUST only appear on `part`-kind slots and on commits that
carry a `partNumber`. Init and segment objects are never expressed as byte
ranges. The segment address fields identify the virtual segment for
rendering. They carry no upload or publication authority of their own
(Section 8).

Schema: see Appendix A, `OLOS_UPLOAD_SLOT_SCHEMA`.

## 3.4 Commit

A commit binds an observed upload to its slot's position in stream state
(Section 4.5). All positional and addressing fields are copied from the
slot. The size and etag come from the observed upload. A commit carries
no `kind`: the slot it consumes determines whether the object is an init
object, a segment, or a part.

| Field            | Req | Constraints                                     |
| ---------------- | --- | ----------------------------------------------- |
| `commitId`       | yes | URL-safe identifier.                            |
| `slotId`         | yes | The slot this commit consumes.                  |
| `sessionId`      | yes | URL-safe identifier.                            |
| `trackId`        | yes | URL-safe identifier. The slot's track.          |
| `epoch`          | yes | Non-negative integer. The slot's epoch.         |
| `sequenceNumber` | yes | Non-negative integer. The slot's sequence       |
|                  |     | number.                                         |
| `partNumber`     | no  | Non-negative integer. Present if and only if    |
|                  |     | the slot reserved a part.                       |
| `objectKey`      | yes | Safe object key. The slot's key.                |
| `deliveryUrl`    | yes | Safe delivery URL. The slot's URL.              |
| `size`           | yes | Positive integer. The observed size.            |
| `etag`           | no  | Non-empty string. The observed etag.            |
| `committedAt`    | yes | RFC 3339 timestamp.                             |
| `byterange`      | no  | Byterange. Only with `partNumber`. The slot's   |
|                  |     | byterange.                                      |
| `profile`        | no  | Profile data about the object (opaque to Core). |

A commit MUST NOT carry `byterange` without `partNumber` (Section 3.3.1).

The commit's `profile` is the merge of the slot's `profile` and the
profile data supplied with the commit request: every top-level key of the
slot's profile is carried over, and a key present in the request replaces
the slot's value for that key (the commit wins per key). When neither
contributes a key, the field is omitted. The coordinator copies the
result unchanged onto the committed object (Section 3.9). Duplicate-commit
idempotency (Section 4.5) compares `profile` by structural JSON equality.
In the CMAF/LL-HLS profile the commit's profile carries the object's
`duration` and, for parts, `independent` (Section 8).

Schema: see Appendix A, `OLOS_COMMIT_SCHEMA`.

## 3.5 UploadGrant

An upload grant authorizes the single upload a slot reserves.

| Field             | Req | Constraints                                  |
| ----------------- | --- | -------------------------------------------- |
| `slotId`          | yes | URL-safe identifier of the granted slot.     |
| `method`          | yes | MUST be `"PUT"`.                             |
| `url`             | yes | Absolute HTTP(S) URL. MAY carry a query      |
|                   |     | string (for example a presigned signature).  |
| `expiresAt`       | yes | RFC 3339 timestamp.                          |
| `requiredHeaders` | no  | Map of valid HTTP header names to string     |
|                   |     | values the upload request MUST send.         |

Grant issuance rules, the required-header baseline (exact content type,
conditional create, slot-id metadata), and provider binding are defined in
Section 7.

Schema: see Appendix A, `OLOS_UPLOAD_GRANT_SCHEMA`.

## 3.6 StorageObject and ObservedUpload

A StorageObject describes an object as observed in storage:

| Field         | Req | Constraints                          |
| ------------- | --- | ------------------------------------ |
| `providerId`  | yes | URL-safe identifier.                 |
| `objectKey`   | yes | Safe object key.                     |
| `contentType` | yes | Valid MIME content type.             |
| `size`        | yes | Positive integer (bytes).            |
| `etag`        | no  | Non-empty string.                    |
| `observedAt`  | yes | RFC 3339 timestamp of observation.   |

An ObservedUpload is a StorageObject plus an optional `metadata` map of
HTTP-header-safe string keys to string values. One example is the
`x-olos-slot-id` metadata written at upload time (Section 4.4).

Schema: see Appendix A, `OLOS_STORAGE_OBJECT_SCHEMA`.

## 3.7 ProviderCapabilityDocument

A provider capability document declares, per storage provider, which
protocol preconditions the provider satisfies.

| Field         | Req | Constraints                                      |
| ------------- | --- | ------------------------------------------------ |
| `olos`        | yes | MUST be `"1.0"`.                                 |
| `providerId`  | yes | URL-safe identifier.                             |
| `kind`        | yes | Currently only `object-store`.                   |
| `consistency` | yes | `headAfterCreate` and `readAfterCreate` REQUIRED |
|               |     | (`strong`, `eventual`, or `unknown`).            |
|               |     | `listAfterCreate` OPTIONAL.                      |
| `publication` | yes | `createIfAbsent` and `directObjectPublication`   |
|               |     | REQUIRED booleans. `manifestGatedPublication`,   |
|               |     | `overwritesAllowed`,                             |
|               |     | `privateUploadPublicPromotion`, and              |
|               |     | `readGateAvailable` OPTIONAL.                    |
| `uploadGrants`| yes | `contentTypeBound`, `exactKey`, `methodBound`,   |
|               |     | `objectSizeCanBeObserved`, and                   |
|               |     | `requiredHeadersCanBeSigned` REQUIRED booleans.  |
|               |     | `presignedPut`, `temporaryCredentials`, and      |
|               |     | `maxRecommendedTtlSeconds` (positive integer)    |
|               |     | OPTIONAL.                                        |
| `delivery`    | yes | `publicBaseUrl` (absolute HTTP(S) URL without    |
|               |     | query or fragment) and                           |
|               |     | `negativeCachingPolicyDeclared` REQUIRED.        |
|               |     | `immutableCaching`, `rangeRequests`, and         |
|               |     | `documentNavigationCanBeBlocked` OPTIONAL.       |
| `events`      | no  | OPTIONAL `objectCreated` boolean and `delivery`  |
|               |     | mode (`none`, `best-effort`, `at-least-once`,    |
|               |     | `exactly-once`).                                 |
| `api`         | no  | OPTIONAL `family` string.                        |

Cross-field preconditions:

- `uploadGrants` MUST declare at least one grant mechanism:
  `presignedPut: true` or `temporaryCredentials: true`.
- If `publication.directObjectPublication` is `true`, the document MUST
  also declare `consistency.headAfterCreate: "strong"`,
  `delivery.negativeCachingPolicyDeclared: true`, and
  `publication.manifestGatedPublication: true`, and MUST NOT declare
  `publication.overwritesAllowed: true` (Section 7, Section 10).

Schema: see Appendix A, `OLOS_PROVIDER_CAPABILITY_SCHEMA`.

## 3.8 Cursor

The cursor is the coordinator's authoritative live-edge document
(Section 4.7).

| Field             | Req | Constraints                                  |
| ----------------- | --- | -------------------------------------------- |
| `olos`            | yes | MUST be `"1.0"`.                             |
| `sessionId`       | yes | URL-safe identifier.                         |
| `state`           | yes | The session state at cursor time.            |
| `epoch`           | yes | MUST equal `committedWindow.epoch`.          |
| `profile`         | yes | The session profile, copied unchanged from   |
|                   |     | the session (Section 3.2). JSON object with  |
|                   |     | a non-empty string `id`.                     |
| `deliveryBaseUrl` | yes | Safe delivery URL. Relative delivery URLs in |
|                   |     | the window resolve against it.               |
| `updatedAt`       | yes | RFC 3339 timestamp.                          |
| `committedWindow` | yes | CommittedWindow object (Section 3.9).        |
| `window`          | yes | Summary object. See below.                   |

`window` carries `firstSequenceNumber` and `lastSequenceNumber`
(non-negative integers, first MUST NOT exceed last) and an OPTIONAL
`lastPartNumber`. The summary MUST agree with the embedded committed
window. Both sequence bounds MUST equal the committed window's bounds.
When `lastPartNumber` is present, it MUST equal the last visible part
number of the window (Section 5.6).

The cursor carries no timing targets of its own. A profile that needs
them (the CMAF/LL-HLS profile's segment and part duration targets)
carries them inside `profile`, where renderers read them (Section 8).

Schema: see Appendix A, `OLOS_CURSOR_SCHEMA`.

## 3.9 CommittedWindow

| Field                 | Req | Constraints                              |
| --------------------- | --- | ---------------------------------------- |
| `epoch`               | yes | Non-negative integer.                    |
| `firstSequenceNumber` | yes | Non-negative integer.                    |
| `lastSequenceNumber`  | yes | MUST be >= `firstSequenceNumber`.        |
| `tracks`              | yes | Non-empty map of `trackId` to track      |
|                       |     | window. Each entry's `trackId` MUST      |
|                       |     | equal its key.                           |

The bounds span every track window: `firstSequenceNumber` is the lowest
and `lastSequenceNumber` the highest sequence number of any visible
segment in any track.

A **track window** carries:

| Field      | Req | Constraints                                         |
| ---------- | --- | --------------------------------------------------- |
| `trackId`  | yes | URL-safe identifier equal to the map key.           |
| `init`     | no  | Committed object: the track's init object, when one |
|            |     | has been committed in this epoch.                   |
| `profile`  | no  | Profile data summarizing the track window (opaque   |
|            |     | to Core).                                           |
| `segments` | yes | Non-empty ordered list of committed segments.       |

Core does not require `init`. The track window's `profile` is produced by
the profile's track-window hook at window build time from the visible
segments and the segments trimmed off the front by retention; Core
records what the hook returns and omits the field when the hook returns
nothing. In the CMAF/LL-HLS profile it carries the track's
`discontinuitySequence` when trimming dropped a flagged segment (Section
8.4.2).

A **committed segment** carries `sequenceNumber` (non-negative integer)
and at least one of `segment` (a committed object) and `parts` (a
non-empty ordered list of committed parts). A position with only parts is
valid: the full segment is still being produced.

A **committed object** carries:

| Field         | Req | Constraints                                      |
| ------------- | --- | ------------------------------------------------ |
| `commitId`    | yes | URL-safe identifier of the commit.               |
| `slotId`      | yes | URL-safe identifier of the slot.                 |
| `objectKey`   | yes | Safe object key. The commit's key.               |
| `deliveryUrl` | yes | Safe delivery URL. The commit's URL.             |
| `contentType` | no  | Valid MIME content type.                         |
| `etag`        | no  | Non-empty string. The commit's etag.             |
| `profile`     | no  | Profile data copied unchanged from the commit.   |

A **committed part** is a committed object plus a REQUIRED `partNumber`
(non-negative integer) and an OPTIONAL `byterange` (Section 3.3.1), both
copied from the commit.

Core carries no duration, timing, or continuity fields on committed
objects; a profile defines them inside `profile` (for the CMAF/LL-HLS
profile: `duration`, `independent`, `programDateTime`, and
`discontinuityBefore`, Section 8). The full structural invariants
(monotonic unique segment sequence numbers, monotonic unique part numbers,
and the contiguous-parts prefix rule) are defined in Section 5.

Schema: see Appendix A, `OLOS_COMMITTED_WINDOW_SCHEMA`.

## 3.10 Error envelope

Every protocol error response body is an error envelope:

```json
{
  "error": {
    "code": "olos.unknown_slot",
    "message": "upload slot is unknown",
    "details": { "slotId": "slot_42" }
  }
}
```

`error.code` is REQUIRED and MUST be a value from the `OLOS_ERROR_CODES`
registry. `error.message` is a REQUIRED non-empty human-readable string.
Receivers MUST NOT parse it programmatically. `error.details` is an
OPTIONAL object of machine-readable context.

| Code                             | Meaning                                |
| -------------------------------- | -------------------------------------- |
| `olos.invalid_session`           | Session payload or referenced session  |
|                                  | is invalid or unknown.                 |
| `olos.invalid_state`             | Operation not permitted in the current |
|                                  | state (aborted session, unverified or  |
|                                  | late object, malformed event, ...).    |
| `olos.unknown_slot`              | `slotId` does not identify a known     |
|                                  | upload slot.                           |
| `olos.slot_expired`              | The slot's upload deadline has passed. |
| `olos.key_mismatch`              | Object key does not match the slot or  |
|                                  | conflicts with other upload evidence.  |
| `olos.content_type_mismatch`     | Observed content type differs from the |
|                                  | slot's `contentType`.                  |
| `olos.object_too_large`          | Observed size exceeds `maxBytes`.      |
| `olos.object_too_small`          | Observed size is below `minBytes`.     |
| `olos.duplicate_commit_conflict` | A second commit for a slot carries     |
|                                  | different evidence (Section 4.5).      |
| `olos.cursor_regression`         | Candidate cursor is behind the current |
|                                  | cursor (Section 4.7).                  |
| `olos.provider_unavailable`      | Storage provider cannot be reached.    |
| `olos.quota_exceeded`            | An application-defined quota blocks    |
|                                  | the operation.                         |
| `olos.security_policy_violation` | Publication control or security policy |
|                                  | blocks the operation (Section 10).     |
| `olos.invalid_request`           | Malformed request (HTTP 400).          |
| `olos.not_found`                 | Resource not found (HTTP 404).         |
| `olos.method_not_allowed`        | HTTP method not allowed (HTTP 405).    |
| `olos.conflict`                  | Concurrent-update conflict (HTTP 409). |
| `olos.internal`                  | Unexpected coordinator failure (HTTP   |
|                                  | 500). The message is fixed and never   |
|                                  | carries internal error detail.         |

HTTP status mapping is defined in Section 6.

Schema: see Appendix A, `OLOS_ERROR_SCHEMA`.
