# 7. Storage binding contract

OLOS stores committed objects as immutable objects in an object store.
This section is the abstract contract that a storage binding — a
storage provider together with its coordinator integration — MUST
satisfy. It names operations and guarantees, not a wire protocol: any
store that can create an object at an exact key, refuse to overwrite
it, read its properties back, and echo the metadata attached to it can
carry OLOS. The contract is profile-agnostic: it carries the Core
coordinates (track, sequence number, part number) and the opaque
`profile` data of slots and commits without interpreting them.
Appendix C gives the S3-compatible realisation of this contract; the
reference implementation (`@arsenstorm/olos/s3`) is informative.

## 7.1 Provider requirements

A binding provides three operations to the coordinator: **issue** an
upload grant for a slot (Section 7.2), **observe** an object by key
(Section 7.3), and, optionally, **notify** the coordinator that an
object was created (Section 7.4). A conforming binding MUST satisfy:

- **Exact-key create-if-absent.** An upload grant addresses exactly
  one object key — the key the coordinator derived (Section 7.5) — and
  the store MUST refuse a write that addresses any other key. The
  store MUST create the object only if that key does not already
  exist, and MUST fail the upload if it does. Overwrites of live
  object keys are forbidden (see Section 10). Declared by
  `uploadGrants.exactKey`, `uploadGrants.methodBound`, and
  `publication.createIfAbsent`; that the grant can pin the object's
  content type and its other required request fields is declared by
  `uploadGrants.contentTypeBound` and
  `uploadGrants.requiredHeadersCanBeSigned`.
- **Read-after-create observation.** After an upload succeeds,
  observing the key MUST report the object's size, its content type,
  and the metadata attached at upload time. The store MAY additionally
  report an entity tag and a store-recorded creation or modification
  time. The report MUST be available immediately after the upload
  succeeds, without waiting for propagation. Declared by
  `consistency.headAfterCreate: "strong"` and
  `uploadGrants.objectSizeCanBeObserved`. The coordinator's
  observation step depends on this behavior.
- **Metadata echo.** The metadata record attached to the object at
  upload time (Section 7.2) MUST come back unchanged from observation,
  apart from the name mapping the binding declares. The coordinator
  uses that record to bind the object back to its slot (Section 7.3).
  The capability document has no separate field for this guarantee: it
  is part of `consistency.headAfterCreate` reporting "the metadata
  attached at upload time". A store that cannot echo metadata cannot
  satisfy this contract.
- **Object-created events (OPTIONAL).** A binding MAY deliver
  object-created notifications (Section 7.4), declared by
  `events.objectCreated` and `events.delivery`. Event delivery is an
  optimization. Correctness MUST NOT depend on it (Section 9.4).

## 7.2 Upload grants

<!-- olos-conformance: 7.2 OBJ-GRANT-001 OBJ-GRANT-002 OBJ-GRANT-003 -->

An upload grant ("OLOS UploadGrant", Appendix A) is the coordinator's
authorization for one uploader to write one object:

| Field | Meaning |
| --- | --- |
| `slotId` | Slot the grant belongs to. |
| `method` | The request method the uploader uses. Always `"PUT"`. |
| `url` | A URL the uploader can write the object to with `method`, addressing the slot's object key. |
| `requiredHeaders` | Request headers the uploader MUST send verbatim. Which headers appear is binding-defined; the entries below are REQUIRED of every binding. |
| `expiresAt` | Grant expiry timestamp. |

Requirements:

- The grant MUST address `slot.objectKey` and no other key. How the
  URL encodes the key is binding-defined; the coordinator MUST verify
  the correspondence before it hands out the grant, and MUST NOT issue
  a grant whose URL addresses a different key.
- The coordinator MUST issue a grant only for a slot in state
  `issued`.
- `expiresAt` MUST be at or before `slot.expiresAt`. A grant MUST NOT
  outlive its slot.
- The grant MUST bind the upload to the slot's content type
  (`slot.contentType`) and MUST make the write conditional on the key
  not already existing (Section 7.1). Both bindings MUST be enforced
  by the store, not merely requested by the uploader: an upload that
  drops or alters them MUST fail.
- The grant MUST cause the upload to attach the **slot binding
  metadata** — a metadata record the store echoes back on observation
  (Section 7.3) — carrying at least the slot id (table below).

The slot binding metadata has these abstract names:

| Metadata name | Value | Presence |
| --- | --- | --- |
| `olos-slot-id` | `slot.slotId` | REQUIRED |
| `olos-session-id` | `slot.sessionId` | REQUIRED |
| `olos-track-id` | `slot.trackId` | REQUIRED |
| `olos-epoch` | `slot.epoch`, as a decimal string | REQUIRED |
| `olos-kind` | `slot.kind` | REQUIRED |
| `olos-sequence-number` | `slot.sequenceNumber`, as a decimal string | REQUIRED |
| `olos-part-number` | `slot.partNumber`, as a decimal string | Parts only |

Each binding maps these names onto its store's metadata namespace and
MUST document the mapping; Appendix C gives the S3 mapping. The slot's
`profile` is not written to object metadata. Deployments MAY add extra
required headers or extra metadata, but the additions MUST NOT
override the slot binding metadata, under either its abstract names or
the binding's mapped ones.

Uploaders MUST send every `requiredHeaders` entry unchanged. A store
that can verify the grant's fields MUST reject an upload with missing
or altered ones.

## 7.3 Object observation and slot binding

<!-- olos-conformance: 7.3 OBJ-HEAD-001 -->

Before any commit, the coordinator MUST observe the uploaded object
through the binding. The observation is a single read of the object's
properties, `observe(key[, version])`: it names the object key, and
MAY pin a store-assigned version when the store versions objects. It
yields an "OLOS StorageObject" (Appendix A):

| Field | Source | Presence |
| --- | --- | --- |
| `size` | the object's byte length as the store reports it | REQUIRED |
| `contentType` | the content type the store reports | REQUIRED |
| `etag` | the store's entity tag, when it reports one | OPTIONAL |
| `observedAt` | the store-recorded creation or modification time when the store reports one; otherwise the time of the observation request | REQUIRED |
| metadata | the slot binding metadata echoed back (Section 7.2) | REQUIRED when the object carries it |

Observation is the only authority for these values: the coordinator
MUST reject commits built from unverified claims
(`olos.invalid_state`, Section 6.3.1), and a publisher-supplied size,
content type, or entity tag is never a substitute. Using the
store-recorded time keeps the slot deadline (Section 4.5.3) judged
against store-observed time rather than a client-supplied one; the
request's `committedAt` is only the fallback, used when the store
records no such time.

Metadata echo binds the object to its slot. The coordinator reads the
slot id from observed metadata under the canonical name
`x-olos-slot-id`. A binding MAY carry it under a store-specific
spelling and MUST normalize that spelling to the canonical name before
the coordinator sees it; the reference implementation accepts
`x-olos-slot-id`, `olos-slot-id`, and `x-amz-meta-olos-slot-id` as
equivalent (informative, Appendix C). If observed metadata carries a
slot id that differs from the slot in the commit, the coordinator MUST
reject the commit (`olos.invalid_state`).

## 7.4 Events, completion hints, and precedence

Two external signals can tell the coordinator that an upload finished:

1. **Object-created events** (`eventType: "object.created"`). A
   store-emitted notification that names an object key in the store
   the binding is configured against. Notifications arrive in the
   store's own format; the binding normalizes each one at the ingress
   boundary into an event carrying an event id, the object key, and
   the observed-object fields the store supplies. Normalization MUST
   treat the payload as untrusted: the record MUST name an
   object-creation event for the configured store location, and the
   decoded object key MUST satisfy the path-safety rules of Section
   7.5. A record that fails any check is reported `invalid_event` and
   MUST NOT mutate state; a malformed record MUST NOT invalidate its
   valid siblings. The transport is at-least-once. Deduplication is by
   slot commit state, not by event id: a redelivery routes into the
   idempotent verify-then-commit path (Section 7.9) and reports
   `idempotent`. Event ids are informational (logging and
   correlation), and a binding derives them from whatever stable
   identifier the store's notification carries. A redelivery for a
   slot that retention has pruned fails per record with
   `olos.unknown_slot`.
2. **Completion hints** (`eventType: "upload.completed"`). The
   publisher delivers them over the completion-hint route
   (Section 6.6.3) with `slotId` and `objectKey`.

Precedence of upload evidence, in decreasing order of authority:

1. An observation of the object (Section 7.3). It is always
   authoritative for size, content type, and entity tag.
2. An object-created event. It is a trigger that identifies the key.
   The coordinator still observes the object before it commits.
3. A completion hint. It is a trigger only. If a hint has no
   observable object, the slot continues to wait for its object, and
   the hint MUST NOT commit.

If a hint and an observation both exist and their object keys
disagree, the evidence conflicts. The coordinator MUST reject it with
`olos.key_mismatch`. Events and hints route into the same
verify-then-commit path. Neither bypasses observation.

## 7.5 Object-key derivation

<!-- olos-conformance: 7.5 OBJ-LAYOUT-001 -->

The coordinator derives every object key. Publishers MUST NOT choose
keys (Section 6.5.1). The coordinator builds keys from a prefix
(default `objects`), the track id, and a kind-specific file name. The
reference implementation's `createPublisherObjectKey`
(`@arsenstorm/olos/state`) performs this derivation (informative).
With `<p>` the
prefix, `<tid>` the track id, `<seq>` the sequence number, `<n>` the
part number, `[-nonce]` present only when a nonce is set (Section
7.6), and `[.ext]` present only when an extension is set:

| Kind | Key |
| --- | --- |
| `init` | `<p>/<tid>/init[-nonce][.ext]` |
| `segment` | `<p>/<tid>/s<seq>[-nonce][.ext]` |
| `part` | `<p>/<tid>/s<seq>/p<n>[-nonce][.ext]` |

The nonce is appended to the file name, after `init`, `s<seq>`, or
`p<n>`, and before the extension. Core defines no default extension.
When the slot-issue payload carries no `extension`, the key has none.
A profile MAY require extensions; the CMAF/LL-HLS profile requires
`mp4` for `init` and `m4s` for `segment` and `part` (Section 8). An
`extension` received on the wire MUST be a non-empty safe path segment
without `/` or `.`. The coordinator rejects a value that carries a dot
with `400`. It likewise rejects a prefix override with a leading or
trailing slash, or with empty, `.`, or `..` segments. Only the
derivation helper trims prefix slashes and strips leading extension
dots when a deployment calls it directly.

Every object key, derived or received on the wire, MUST satisfy the
path-safety rules:

- non-empty,
- no leading or trailing `/`,
- no empty, `.`, or `..` segments,
- no control characters,
- no `?` or `#`.

A key that fails these rules MUST be rejected wherever it appears.

The delivery URL for an object is the session's `deliveryBaseUrl` with
`/<objectKey>` appended to its path. The coordinator omits any query
or fragment on the base URL.

## 7.6 Object-key nonce

The nonce makes future object URLs unguessable in direct-public mode.

- Format: `<prefix>_<hex>`, default prefix `slot`, where `<hex>` is
  the lowercase hexadecimal encoding of the random bytes. The prefix
  MUST be a URL-safe identifier.
- Entropy: at least 16 random bytes (32 hex characters).
- When `publicationMode` is `direct-public` and the slot-issue payload
  supplies no `objectKeyNonce`, the coordinator MUST generate a fresh
  16-byte nonce per slot. For `read-gated` and
  `private-upload-public-promotion` deployments, the publisher owns
  the nonce policy. In these deployments, the nonce MAY be omitted.

## 7.7 Provider capability document

<!-- olos-conformance: 7.7 OBJ-GRANT-004 OBJ-GRANT-005 -->

A capability document ("OLOS ProviderCapabilityDocument", Appendix A)
describes each provider. The document has `olos: "1.0"`, `providerId`,
`kind: "object-store"`, and the `consistency`, `publication`,
`uploadGrants`, `delivery`, and optional `events` and `api` sections.
`api.family` names the store API the binding speaks, and is how a
deployment tells one binding's documents from another's. The document
describes what a provider can do. The reference coordinator does not
evaluate it at request time. A deployment MUST evaluate it before it
configures a coordinator to issue grants for the provider. The
reference implementation's `assertProviderCanIssueUploadGrant` and
`canProviderIssueUploadGrant` (`@arsenstorm/olos/state`) perform these
checks (informative); an equivalent check is acceptable. If a
deployment does not explicitly waive a check, it MUST NOT configure
grant issuance unless:

- `uploadGrants.exactKey`, `uploadGrants.methodBound`,
  `uploadGrants.contentTypeBound`,
  `uploadGrants.requiredHeadersCanBeSigned`, and
  `uploadGrants.objectSizeCanBeObserved` are all `true`.
- the grant-issuance mechanism the binding uses is declared: the
  schema REQUIRES `uploadGrants.presignedPut` or
  `uploadGrants.temporaryCredentials` to be `true`, and the binding
  MUST declare the one it uses. The reference check requires
  `presignedPut` by default, because its own binding signs URLs
  (Appendix C); a binding that issues grants the other way waives that
  check (`requirePresignedPut: false`).
- `publication.createIfAbsent` is `true`.
- the grant TTL is positive and, when the provider declares
  `uploadGrants.maxRecommendedTtlSeconds`, does not exceed it.

Publication-mode gates:

- `direct-public` REQUIRES `publication.directObjectPublication`,
  `publication.manifestGatedPublication`, and
  `delivery.negativeCachingPolicyDeclared` all `true`.
- `read-gated` REQUIRES `publication.readGateAvailable: true`.
- `private-upload-public-promotion` REQUIRES
  `publication.privateUploadPublicPromotion: true`.

## 7.8 Publication references

<!-- olos-conformance: 7.8 OBJ-PUB-001 OBJ-PUB-002 -->

Committed objects are published according to the session's publication
mode. In `direct-public` mode, the coordinator derives the public
delivery URL from `delivery.publicBaseUrl` plus the object key.
Publication is manifest-gated. An object becomes part of the stream
only when the committed window references it. Its bytes can be
readable earlier (Section 10.1). Read-gated and promotion modes keep
the committed delivery URL behind the provider's read gate or
promotion step. The reference coordinator does not check mode support
at commit time or at session creation. A deployment MUST choose a
`publicationMode` that the provider's capability document supports
(Section 7.7). The reference implementation's
`createObjectPublication` (`@arsenstorm/olos/state`) asserts mode
support when it builds a publication reference (informative); an
equivalent check is acceptable.

## 7.9 End-to-end upload flow

<!-- olos-conformance: 7.9 OBJ-FLOW-001 OBJ-FLOW-002 OBJ-FLOW-003 -->

The normative sequence for one object:

1. The publisher requests a slot (plus grant) as in Sections 6.5.1 and
   6.6.1.
2. Before `grant.expiresAt`, the publisher uploads the bytes with a
   `grant.method` request to `grant.url` and sends every
   `requiredHeaders` entry unchanged.
3. The coordinator learns of the upload through a completion hint, a
   store event, or reconciliation.
4. The coordinator observes the object (Section 7.3) and makes sure
   that it matches the slot (key, content type, size bounds). The
   coordinator then commits it, carrying the request `profile` merged
   over the slot `profile` (Section 6.5.2). The commit advances the
   cursor and the committed window (Sections 4 and 5).

Steps 3 and 4 are idempotent. Any combination of hint, event, and
reconciliation for the same upload MUST converge on exactly one
commit. Duplicates are `idempotent`. Conflicting duplicates are
rejected.

## 7.10 Byterange aggregation service

Deployments that address parts by byterange within a virtual segment
(Section 8.5) MUST serve Range requests over the aggregate. The
aggregate is the committed parts whose `byterange.segmentObjectKey`
names the requested virtual segment, concatenated in offset order.
Aggregation is byte arithmetic over `byterange.offset` and
`byterange.length` only. It reads no `profile` data and assigns no
time meaning to parts. Behavior:

| Request | Status | Headers | Body |
| --- | --- | --- | --- |
| No range | `200` | no `content-range` / `content-length` | full aggregate, streamed |
| Open-ended (`start` only) | `206` | `content-range: bytes <start>-9007199254740991/*`, no `content-length` | bytes from `start`, streamed live |
| Bounded (`start`–`end`) | `206` | `content-range: bytes <start>-<end>/*`, `content-length` | exactly the promised bytes |
| Negative `start`, or `end < start` | `416` | — | — |
| Unknown session or no cursor | `404` | — | — |

All success responses carry `accept-ranges: bytes`,
`cache-control: no-store`, and a caller-supplied `content-type`
(`createByterangeSegmentResponse`'s required `contentType` option). Under
the CMAF/LL-HLS profile it is `video/mp4`; a deployment serving another
profile's objects supplies that profile's content type.

- Bounded responses use the RFC 9110 `content-range` form with an
  unknown complete length (`bytes <first>-<last>/*`), because the
  virtual segment still grows.
- Open-ended responses are `206`, not `200`: a `200` would claim a
  complete representation from offset 0. RFC 8673 prescribes `206`
  with a very large last-byte-pos for live open-ended ranges;
  `9007199254740991` (`Number.MAX_SAFE_INTEGER`) is that value here.
  They MUST NOT carry `content-length`; the body streams to the live
  edge and a clean close marks the end of the available content.
- The service MUST release an in-flight part fetch (and any pending
  cursor wait) when the viewer disconnects or cancels the response
  body, so an abandoned response does not hold sockets open.
- When a requested range extends past the committed bytes, the service
  SHOULD hold the response open and continue to stream as new parts
  commit (bounded by a wait timeout, default 3000 ms). This behavior
  is the transport for `EXT-X-PRELOAD-HINT` (Section 8.5).
- Fail-fast: if a part object returns no body, or returns zero bytes
  for a requested range, the service MUST error the response stream.
  The service does not emit silently truncated objects.
- Short supply on a bounded range: after the service sends `206` with
  `content-length`, a shortfall MUST surface as a mid-stream error
  (aborted transfer), never as a silently short but cleanly closed
  body.
