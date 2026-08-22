# Appendix C: S3-compatible storage binding

This appendix is informative. It describes how a deployment on an
S3-compatible object store satisfies the abstract storage binding
contract of Section 7. Nothing here adds a requirement to Section 7.
Where this appendix says MUST, it restates a Section 7 requirement in
the terms of the S3 API. A deployment on a different store satisfies
the same requirement its own way. The reference
implementation of this binding is `@arsenstorm/olos/s3`.

## C.1 Scope

This binding targets stores that implement the Amazon S3 REST API:
Amazon S3 itself, Cloudflare R2, Google Cloud Storage through its S3
interoperability API, and MinIO. A store qualifies when it supports:

- presigned `PUT` with signed headers,
- `If-None-Match: *` on `PutObject`,
- `HeadObject` with user metadata,
- object-created event notifications in the S3 notification record
  format (optional).

Objects live in one bucket per binding configuration. The bucket name
is a non-empty string with no `/` in it. Object keys are the
coordinator-derived keys of Section 7.5, used verbatim as S3 keys with
no bucket segment in them.

## C.2 Upload grant mapping

The grant of Section 7.2 is a presigned `PUT` for the slot's object
key. `UploadGrant.method` is `"PUT"`, and `UploadGrant.url` is the
presigned URL. The URL's path resolves to `slot.objectKey` in either
addressing style:

| Style | Path |
| --- | --- |
| Virtual-hosted | the path equals the object key |
| Path-style | a bucket segment followed by the object key |

The coordinator resolves the path before it wraps the URL in a grant,
and refuses a URL whose path resolves to any other key.

The signature covers the required headers, so S3 rejects an upload
that omits or alters one. `requiredHeaders` carries:

| Header | Value | Implements |
| --- | --- | --- |
| `Content-Type` | `slot.contentType` | content-type binding (Section 7.2) |
| `If-None-Match` | `*` | exact-key create-if-absent (Section 7.1) |
| `x-olos-slot-id` | `slot.slotId` | the canonical slot-id name (Section 7.3) |

plus the slot binding metadata, mapped onto S3 user metadata by
prefixing each abstract name with `x-amz-meta-`:

| Abstract name (Section 7.2) | S3 header |
| --- | --- |
| `olos-slot-id` | `x-amz-meta-olos-slot-id` |
| `olos-session-id` | `x-amz-meta-olos-session-id` |
| `olos-track-id` | `x-amz-meta-olos-track-id` |
| `olos-epoch` | `x-amz-meta-olos-epoch` |
| `olos-kind` | `x-amz-meta-olos-kind` |
| `olos-sequence-number` | `x-amz-meta-olos-sequence-number` |
| `olos-part-number` (parts only) | `x-amz-meta-olos-part-number` |

Numeric values (`olos-epoch`, `olos-sequence-number`,
`olos-part-number`) are decimal strings, because S3 user metadata
carries strings. The slot's `profile` is not written to object
metadata.

A deployment MAY supply additional required headers. They MUST NOT
override `Content-Type`, `If-None-Match`, `x-olos-slot-id`, or any
header in the `x-amz-meta-olos-` namespace.

The grant's `expiresAt` is the presigning time plus the requested
lifetime, and MUST be at or before `slot.expiresAt` (Section 7.2).

## C.3 Observation

`observe(key[, version])` (Section 7.3) is a `HeadObject` against the
configured bucket and the slot's object key, with `VersionId` set when
the caller pins a version. The response maps onto the observed object
as:

| `HeadObject` field | Observed field |
| --- | --- |
| `ContentLength` | `size`. REQUIRED, and a response without it is an error. |
| `ContentType` | `contentType`. REQUIRED, and a response without it is an error. |
| `ETag` | `etag`, when present |
| `LastModified` | `observedAt`, when present |
| `Metadata` | the echoed slot binding metadata |

When `HeadObject` reports no `LastModified`, `observedAt` falls back to
the caller's supplied time (the request's `committedAt`, or the
coordinator clock). An explicit `observedAt` override wins over both.

S3 SDKs strip the `x-amz-meta-` prefix from user metadata. The echoed
slot id therefore arrives under `x-olos-slot-id`, `olos-slot-id`, or
`x-amz-meta-olos-slot-id`, depending on the client.
The binding treats all three as equivalent and normalizes them to the
canonical `x-olos-slot-id` before the coordinator sees the metadata,
leaving the other keys untouched.

## C.4 Events

The store-emitted notification of Section 7.4 is an S3 event
notification document, `{ "Records": [ ... ] }`. Each record is
normalized independently. A payload with no `Records` array yields one
`invalid_event`. A malformed record yields its own `invalid_event`
while its valid siblings pass through.

A record is accepted only when:

- `eventName` starts with `ObjectCreated:`. A record that carries
  another event name is rejected as not object-created.
- `s3.bucket.name` is a valid bucket name. When the binding is
  configured with an expected bucket, the name equals it.
- `s3.object.key` URL-decodes to a safe object key (Section 7.5). S3
  percent-encodes keys and encodes spaces as `+`, so the binding
  replaces `+` with a space before `decodeURIComponent`.
- the record carries an event id:
  `responseElements["x-amz-request-id"]` when present, otherwise
  `s3_<s3.object.sequencer>`. A record with neither is rejected.

`s3.object.size` and `s3.object.eTag` become the event's size and
entity tag, and `eventTime` becomes its observation timestamp. The
notification carries no content type, so the binding assumes
`application/octet-stream` unless the deployment configures another
value. The event is therefore only a trigger, and the coordinator
still observes the object (Section 7.4) before it commits.

Any failed check produces an `invalid_event` normalization carrying an
`olos.invalid_state` error, and MUST NOT mutate state.

## C.5 Capability document values

A conforming S3 deployment declares a capability document (Section 7.7,
"OLOS ProviderCapabilityDocument" in Appendix A) with at least:

| Field | Value | Why |
| --- | --- | --- |
| `api.family` | `"s3"` | identifies this binding |
| `kind` | `"object-store"` | required by the schema |
| `uploadGrants.presignedPut` | `true` | grants are presigned `PUT`s (C.2) |
| `uploadGrants.exactKey` | `true` | the presigned URL addresses one key |
| `uploadGrants.methodBound` | `true` | the signature covers the method |
| `uploadGrants.contentTypeBound` | `true` | `Content-Type` is signed |
| `uploadGrants.requiredHeadersCanBeSigned` | `true` | the metadata headers are signed |
| `uploadGrants.objectSizeCanBeObserved` | `true` | `HeadObject` reports `ContentLength` |
| `publication.createIfAbsent` | `true` | `If-None-Match: *` is honored |
| `consistency.headAfterCreate` | `"strong"` | `HeadObject` reads back immediately |
| `consistency.readAfterCreate` | `"strong"` | required by the schema |

`uploadGrants.maxRecommendedTtlSeconds`, when declared, bounds the
presigned URL lifetime a deployment requests.

Event support, when the deployment configures S3 notifications, is
declared with `events.objectCreated: true` and
`events.delivery: "at-least-once"`. S3 notification delivery is
at-least-once, which is why deduplication is by slot commit state
(Section 7.4).

Publication-mode fields depend on the deployment, and not on the store
API. A `direct-public` deployment additionally declares the fields the
publication-mode gates of Section 7.7 require, and does not declare
`publication.overwritesAllowed: true` (Section 10).
