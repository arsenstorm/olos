# 7. Storage-provider binding (S3 profile)

OLOS stores media as immutable objects on an S3-compatible object
store. This section is the binding profile that a storage provider and
its coordinator integration MUST satisfy. The normative reference is
`olos/src/s3/*` and `olos/src/state/object-key-derivation.ts`,
`object-key-nonce.ts`, and `provider-upload-grant-policy.ts`.

## 7.1 Provider requirements

A conforming provider binding MUST support:

- **Exact-key upload.** Uploads are single-request `PUT`s to the exact
  object key that the coordinator derived. The provider MUST NOT allow
  the grant to write any other key.
- **Conditional create.** The provider MUST create the upload only if
  the key does not already exist. In the S3 profile, this is the
  signed `If-None-Match: *` header on the presigned `PUT`. Overwrites
  of live media keys are forbidden (see Section 10).
- **Read-after-write `HeadObject`.** After a successful upload, a
  `HeadObject` for the key MUST return the object's size, content
  type, and metadata (`consistency.headAfterCreate: "strong"` in the
  capability document). The coordinator's observation step depends on
  this behavior.
- **Metadata echo.** `HeadObject` MUST return the metadata that the
  uploader attached at upload time. The coordinator uses this metadata
  to bind the object back to its slot (Section 7.3).
- **Object-created events (OPTIONAL).** Providers MAY deliver
  object-created notifications (Section 7.4). Event delivery is an
  optimization. Correctness MUST NOT depend on it (Section 9.4).

## 7.2 Upload grants

<!-- olos-conformance: 7.2 OBJ-GRANT-001 OBJ-GRANT-002 OBJ-GRANT-003 -->

An upload grant ("OLOS UploadGrant", Appendix A) is:

| Field | Meaning |
| --- | --- |
| `slotId` | Slot the grant belongs to. |
| `method` | Always `"PUT"`. |
| `url` | Presigned URL whose path resolves to the slot's object key. |
| `requiredHeaders` | Headers the uploader MUST send verbatim. |
| `expiresAt` | Grant expiry timestamp. |

Requirements:

- The presigned URL's path MUST match `slot.objectKey`, either
  virtual-hosted style (path equals the key) or path-style (bucket
  segment followed by the key). The coordinator MUST NOT issue a grant
  whose URL addresses a different key.
- The coordinator MUST issue a grant only for a slot in state
  `issued`.
- `expiresAt` MUST be at or before `slot.expiresAt`. A grant MUST NOT
  outlive its slot.
- The signed required headers MUST include at least:
  - `Content-Type: <slot.contentType>` (content-type bound),
  - `If-None-Match: *` (conditional create),
  - `x-olos-slot-id: <slot.slotId>`,
  - the slot metadata headers `x-amz-meta-olos-epoch`,
    `x-amz-meta-olos-kind`, `x-amz-meta-olos-media-sequence-number`,
    `x-amz-meta-olos-rendition-id`, `x-amz-meta-olos-session-id`,
    `x-amz-meta-olos-slot-id`, and, for parts,
    `x-amz-meta-olos-part-number`.
- Deployments MAY add extra required headers, but additional headers
  MUST NOT override the `x-amz-meta-olos-*` namespace.

Uploaders MUST send every required header unchanged. Providers that
sign headers MUST reject uploads with missing or altered signed
headers.

## 7.3 Object observation and slot binding

<!-- olos-conformance: 7.3 OBJ-HEAD-001 -->

Before any commit, the coordinator MUST observe the uploaded object
through the provider. In the S3 profile, the observation is a
`HeadObject` on the slot's object key (optionally version-pinned with
`versionId`). The observation yields the authoritative `size`,
`contentType`, `etag`, `observedAt` (from `Last-Modified` when the
caller supplies no timestamp), and metadata. The coordinator MUST
reject commits built from unverified claims (`olos.invalid_state`,
Section 6.3.1).

Metadata echo binds the object to its slot. The coordinator reads the
slot id from observed metadata under the key `x-olos-slot-id`. It
accepts the provider spellings `olos-slot-id` and
`x-amz-meta-olos-slot-id` as equivalent and normalizes them to
`x-olos-slot-id`. If observed metadata carries a slot id that differs
from the slot in the commit, the coordinator MUST reject the commit
(`olos.invalid_state`).

## 7.4 Events, completion hints, and precedence

Two external signals can tell the coordinator that an upload finished:

1. **Object-created events** (`eventType: "object.created"`). The
   ingress boundary normalizes S3 notification records. The record
   MUST be an `ObjectCreated:*` event for the configured bucket. The
   object key is URL-decoded (with `+` as space) and MUST be a safe
   object key. The event id comes from the request id or, when the
   request id is absent, from the sequencer. A record that fails any
   check is reported `invalid_event` and MUST NOT mutate state. Event
   ids MUST be used to deduplicate deliveries (the transport is
   at-least-once).
2. **Completion hints** (`eventType: "upload.completed"`). The
   publisher delivers them over the completion-hint route
   (Section 6.6.3) with `slotId` and `objectKey`.

Precedence of upload evidence, in decreasing order of authority:

1. A provider observation of the object (`HeadObject`). It is always
   authoritative for size, content type, and etag.
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
(default `media`, leading/trailing slashes trimmed), the rendition id,
and a kind-specific file name. With `<p>` the prefix, `<rid>` the
rendition id, `<msn>` the media sequence number, `<n>` the part
number, and `<ext>` the extension:

| Kind | Without nonce | With nonce |
| --- | --- | --- |
| `init` | `<p>/<rid>/init.<ext>` | `<p>/<rid>/init-<nonce>.<ext>` |
| `segment` | `<p>/<rid>/s<msn>.<ext>` | `<p>/<rid>/s<msn>-<nonce>.<ext>` |
| `part` | `<p>/<rid>/s<msn>/p<n>.<ext>` | `<p>/<rid>/s<msn>/p<n>-<nonce>.<ext>` |

Default extensions: `mp4` for `init`, `m4s` for `segment` and `part`.
A supplied extension override MUST be a safe path segment and MUST be
in the supported set for the kind (`init`: `.mp4`, `segment`/`part`:
`.m4s`). The coordinator strips leading dots from the extension.

Every object key, derived or received on the wire, MUST satisfy the
path-safety rules:

- non-empty,
- no leading or trailing `/`,
- no empty, `.`, or `..` segments,
- no control characters,
- no `?` or `#`.

A key that fails these rules MUST be rejected wherever it appears.

The delivery URL for an object is the session's `mediaBaseUrl` with
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
Coordinators MUST evaluate the document before they issue grants. If a
deployment does not explicitly waive a check, a grant MUST NOT be
issued unless:

- `uploadGrants.presignedPut`, `uploadGrants.exactKey`,
  `uploadGrants.methodBound`, `uploadGrants.contentTypeBound`,
  `uploadGrants.requiredHeadersCanBeSigned`, and
  `uploadGrants.objectSizeCanBeObserved` are all `true`.
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
promotion step. If the provider does not support the session's mode,
the coordinator MUST reject commits.

## 7.9 End-to-end upload flow

<!-- olos-conformance: 7.9 OBJ-FLOW-001 OBJ-FLOW-002 OBJ-FLOW-003 -->

The normative sequence for one media object:

1. The publisher requests a slot (plus grant) as in Sections 6.5.1 and
   6.6.1.
2. Before `grant.expiresAt`, the publisher uploads the bytes with a
   `PUT` to `grant.url` and sends every `requiredHeaders` entry.
3. The coordinator learns of the upload through a completion hint, a
   provider event, or reconciliation.
4. The coordinator observes the object (Section 7.3) and makes sure
   that it matches the slot (key, content type, size bounds). The
   coordinator then commits it. The commit advances the cursor and the
   committed window (Sections 4 and 5).

Steps 3 and 4 are idempotent. Any combination of hint, event, and
reconciliation for the same upload MUST converge on exactly one
commit. Duplicates are `idempotent`. Conflicting duplicates are
rejected.

## 7.10 Byterange aggregation service

Deployments that address parts by byterange within a virtual segment
(Section 8.5) MUST serve Range requests over the aggregate. The
aggregate is the committed parts whose `byterange.segmentObjectKey`
names the requested virtual segment, concatenated in offset order.
Behavior:

| Request | Status | Headers | Body |
| --- | --- | --- | --- |
| No range | `200` | no `content-range` / `content-length` | full aggregate, streamed |
| Open-ended (`start` only) | `206` | `content-range: bytes <start>-9007199254740991/*`, no `content-length` | bytes from `start`, streamed live |
| Bounded (`start`–`end`) | `206` | `content-range: bytes <start>-<end>/*`, `content-length` | exactly the promised bytes |
| Negative `start`, or `end < start` | `416` | — | — |
| Unknown session or no cursor | `404` | — | — |

All success responses carry `accept-ranges: bytes`,
`cache-control: no-store`, and `content-type: video/mp4`.

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
  The service does not emit silently truncated media.
- Short supply on a bounded range: after the service sends `206` with
  `content-length`, a shortfall MUST surface as a mid-stream error
  (aborted transfer), never as a silently short but cleanly closed
  body.
