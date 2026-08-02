# 03 Data model

This section defines every wire object normatively, field by field. The
machine-readable JSON Schemas in Appendix A are generated from the
reference implementation. Constraints that JSON Schema 2020-12 cannot
express (cross-field and cross-sibling rules) are stated here in prose.
These prose constraints are equally binding.

## 3.1 Wire object conventions

<!-- olos-conformance: 3.1 CORE-SCHEMA-001 -->

- Every wire object is a JSON object. All objects are closed. Receivers
  MUST reject unknown properties (Section 1.2).
- Field types follow the conventions of Section 1.2: RFC 3339 timestamps,
  URL-safe identifiers, integer byte sizes, and durations in seconds.
- Each object defined below has a published JSON Schema. An implementation
  MUST accept every payload that the schema plus the prose constraints
  accept. It MUST reject every payload that either rejects.

## 3.2 Session

A session declares one live stream.

| Field            | Req | Constraints                                     |
| ---------------- | --- | ----------------------------------------------- |
| `olos`           | yes | MUST be the wire version `"1.0"`.               |
| `sessionId`      | yes | URL-safe identifier.                            |
| `epoch`          | yes | Non-negative integer.                           |
| `state`          | yes | One of `live`, `ending`, `ended`, `aborted`.    |
| `latencyProfile` | yes | Currently only `object-ll`.                     |
| `segmentTarget`  | yes | Positive number. Target segment seconds.        |
| `partTarget`     | yes | Positive number. Target part seconds.           |
| `createdAt`      | yes | RFC 3339 timestamp.                             |
| `renditions`     | yes | Non-empty array of Rendition objects.           |

`renditions` MUST NOT contain two entries with the same `renditionId`.

### 3.2.1 Rendition

| Field              | Req | Constraints                                  |
| ------------------ | --- | -------------------------------------------- |
| `renditionId`      | yes | URL-safe identifier, unique in the session.  |
| `kind`             | yes | `audio`, `video`, `text`, or `metadata`.     |
| `codec`            | yes | Non-empty string.                            |
| `bitrate`          | no  | Positive integer (bits per second).          |
| `width`, `height`  | no  | Positive integers. MUST appear together.     |
| `frameRate`        | no  | Positive number.                             |
| `channels`         | no  | Positive integer.                            |
| `sampleRate`       | no  | Positive integer.                            |
| `groupId`          | no  | URL-safe identifier. Audio renditions only.  |
| `name`             | no  | Non-empty string. Audio renditions only.     |
| `defaultRendition` | no  | Boolean. Audio renditions only.              |

`groupId`, `name`, and `defaultRendition` describe HLS audio-group
membership through `EXT-X-MEDIA` `GROUP-ID`, `NAME`, and `DEFAULT`
(Section 08). They MUST NOT appear on a rendition whose `kind` is not
`audio`.

The following constraints span sibling renditions and MUST be enforced
even though the JSON Schema cannot express them:

- A session's audio renditions MUST be either all grouped (every audio
  rendition carries `groupId`) or all ungrouped. A mix of grouped and
  ungrouped audio renditions is invalid.
- All grouped audio renditions MUST carry the same `groupId`. A session
  has at most one audio group.
- At most one audio rendition MAY set `defaultRendition: true`.

Schema: see Appendix A, `OLOS_SESSION_SCHEMA`.

## 3.3 UploadSlot

An upload slot reserves exactly one media object (Section 4.2).

| Field                 | Req | Constraints                                |
| --------------------- | --- | ------------------------------------------ |
| `slotId`              | yes | URL-safe identifier, unique per session.   |
| `sessionId`           | yes | URL-safe identifier of the owning session. |
| `renditionId`         | yes | MUST name a rendition of the session.      |
| `epoch`               | yes | Non-negative integer. The session's epoch. |
| `kind`                | yes | `init`, `part`, or `segment`.              |
| `state`               | yes | One of `issued`, `upload_observed`,        |
|                       |     | `committed`, `expired`, `rejected`,        |
|                       |     | `revoked`.                                 |
| `mediaSequenceNumber` | yes | Non-negative integer.                      |
| `partNumber`          | no  | Non-negative integer. Part slots only.     |
| `objectKey`           | yes | Safe object key (Section 1.3) whose        |
|                       |     | extension matches the kind: `.mp4` for     |
|                       |     | `init`, `.m4s` for `part` and `segment`.   |
| `deliveryUrl`         | yes | Safe delivery URL (Section 1.3).           |
| `contentType`         | yes | Valid MIME content type.                   |
| `duration`            | yes | Positive number (seconds).                 |
| `maxBytes`            | yes | Positive integer.                          |
| `minBytes`            | no  | Non-negative integer.                      |
| `expiresAt`           | yes | RFC 3339 timestamp.                        |
| `byterange`           | no  | Byterange object. `kind` MUST be `part`.   |

When both bounds are present, `minBytes` MUST be less than or equal to
`maxBytes`. This is a cross-field rule not expressed in the schema.

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
manifest rendering. They carry no upload or publication authority of their
own (Section 08).

Schema: see Appendix A, `OLOS_UPLOAD_SLOT_SCHEMA`.

## 3.4 Commit

A commit binds an observed upload to its slot's position in stream state
(Section 4.5). All positional and addressing fields are copied from the
slot. The size and etag come from the observed upload.

| Field                 | Req | Constraints                                |
| --------------------- | --- | ------------------------------------------ |
| `commitId`            | yes | URL-safe identifier.                       |
| `slotId`              | yes | The slot this commit consumes.             |
| `sessionId`           | yes | URL-safe identifier.                       |
| `renditionId`         | yes | URL-safe identifier.                       |
| `epoch`               | yes | Non-negative integer. The slot's epoch.    |
| `mediaSequenceNumber` | yes | Non-negative integer. The slot's MSN.      |
| `partNumber`          | no  | Non-negative integer. Present if and only  |
|                       |     | if the slot reserved a part.               |
| `objectKey`           | yes | Safe object key. The slot's key.           |
| `deliveryUrl`         | yes | Safe delivery URL. The slot's URL.         |
| `duration`            | yes | Positive number. The slot's duration.      |
| `size`                | yes | Positive integer. The observed size.       |
| `etag`                | no  | Non-empty string. The observed etag.       |
| `committedAt`         | yes | RFC 3339 timestamp.                        |
| `programDateTime`     | no  | RFC 3339 timestamp.                        |
| `independent`         | no  | Boolean. The part starts with an           |
|                       |     | independent frame.                         |
| `byterange`           | no  | Byterange. Only with `partNumber`.         |

A commit MUST NOT carry `byterange` without `partNumber` (Section 3.3.1).

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
Section 07.

Schema: see Appendix A, `OLOS_UPLOAD_GRANT_SCHEMA`.

## 3.6 MediaObject and ObservedUpload

A MediaObject describes an object as observed in storage:

| Field         | Req | Constraints                          |
| ------------- | --- | ------------------------------------ |
| `providerId`  | yes | URL-safe identifier.                 |
| `objectKey`   | yes | Safe object key.                     |
| `contentType` | yes | Valid MIME content type.             |
| `size`        | yes | Positive integer (bytes).            |
| `etag`        | no  | Non-empty string.                    |
| `observedAt`  | yes | RFC 3339 timestamp of observation.   |

An ObservedUpload is a MediaObject plus an optional `metadata` map of
HTTP-header-safe string keys to string values. One example is the
`x-olos-slot-id` metadata written at upload time (Section 4.4).

Schema: see Appendix A, `OLOS_MEDIA_OBJECT_SCHEMA`.

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
  `publication.overwritesAllowed: true` (Section 07, Section 10).

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
| `latencyProfile`  | yes | Currently only `object-ll`.                  |
| `segmentTarget`   | yes | Positive number.                             |
| `partTarget`      | yes | Positive number.                             |
| `mediaBaseUrl`    | yes | Safe delivery URL.                           |
| `updatedAt`       | yes | RFC 3339 timestamp.                          |
| `committedWindow` | yes | CommittedWindow object (Section 3.9).        |
| `window`          | yes | Summary object. See below.                   |

`window` carries `firstMediaSequenceNumber` and
`lastMediaSequenceNumber` (non-negative integers, first MUST NOT exceed
last) and an OPTIONAL `lastPartNumber`. The summary MUST agree with the
embedded committed window. Both MSN bounds MUST equal the committed
window's bounds. When `lastPartNumber` is present, it MUST equal the last
visible part number of the window (Section 5.6).

Schema: see Appendix A, `OLOS_CURSOR_SCHEMA`.

## 3.9 CommittedWindow

| Field                     | Req | Constraints                          |
| ------------------------- | --- | ------------------------------------ |
| `epoch`                   | yes | Non-negative integer.                |
| `discontinuitySequence`   | yes | Non-negative integer.                |
| `firstMediaSequenceNumber`| yes | Non-negative integer.                |
| `lastMediaSequenceNumber` | yes | MUST be >= the first MSN.            |
| `renditions`              | yes | Non-empty map of `renditionId` to    |
|                           |     | rendition window. Each entry's       |
|                           |     | `renditionId` MUST equal its key.    |

Each rendition window carries an `init` committed object, its
`renditionId`, and a non-empty ordered list of committed segments. The
full structural invariants (monotonic unique segment MSNs, monotonic
unique part numbers, the contiguous-parts prefix rule, and duration
semantics) are defined in Section 05.

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

HTTP status mapping is defined in Section 06.

Schema: see Appendix A, `OLOS_ERROR_SCHEMA`.
