# 7. Storage-provider binding (S3 profile)

OLOS stores media as immutable objects on an S3-compatible object
store. This section is the binding profile a storage provider and its
coordinator integration MUST satisfy. The normative reference is
`olos/src/s3/*` and `olos/src/state/object-key-derivation.ts`,
`object-key-nonce.ts`, and `provider-upload-grant-policy.ts`.

## 7.1 Provider requirements

A conforming provider binding MUST support:

- **Exact-key upload.** Uploads are single-request `PUT`s to the exact
  object key the coordinator derived. The provider MUST NOT allow the
  grant to write any other key.
- **Conditional create.** The upload MUST be created only if the key
  does not already exist. In the S3 profile this is the signed
  `If-None-Match: *` header on the presigned `PUT`. Overwrites of live
  media keys are forbidden (see Section 10).
- **Read-after-write `HeadObject`.** After a successful upload, a
  `HeadObject` for the key MUST return the object's size, content
  type, and metadata (`consistency.headAfterCreate: "strong"` in the
  capability document). The coordinator's verification step depends on
  this.
- **Metadata echo.** Metadata attached at upload time MUST be returned
  by `HeadObject` so the coordinator can bind the object back to its
  slot (Section 7.3).
- **Object-created events (OPTIONAL).** Providers MAY deliver
  object-created notifications (Section 7.4). Event delivery is an
  optimization; correctness MUST NOT depend on it (Section 9.4).

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
  segment followed by the key). Grants whose URL addresses a different
  key MUST NOT be issued.
- The grant MUST be issued only for a slot in state `issued`.
- `expiresAt` MUST be at or before `slot.expiresAt`; a grant MUST NOT
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

Uploaders MUST send every required header unchanged; providers that
sign headers MUST reject uploads with missing or altered signed
headers.

## 7.3 Object observation and slot binding

<!-- olos-conformance: 7.3 OBJ-HEAD-001 -->

Before any commit, the coordinator MUST verify the uploaded object by
provider observation — in the S3 profile, a `HeadObject` on the slot's
object key (optionally version-pinned via `versionId`). The
observation yields the authoritative `size`, `contentType`, `etag`,
`observedAt` (from `Last-Modified` when the caller supplies no
timestamp), and metadata. Commits built from unverified claims MUST be
rejected (`olos.invalid_state`, Section 6.3.1).

Slot binding via metadata echo: the coordinator reads the slot id from
observed metadata under the key `x-olos-slot-id`, accepting provider
spellings `olos-slot-id` and `x-amz-meta-olos-slot-id` as equivalent
and normalizing them to `x-olos-slot-id`. When observed metadata
carries a slot id that differs from the slot being committed, the
commit MUST be rejected (`olos.invalid_state`).

## 7.4 Events, completion hints, and precedence

Two external signals can tell the coordinator an upload finished:

1. **Object-created events** (`eventType: "object.created"`). S3
   notification records are normalized at the ingress boundary:
   the record MUST be an `ObjectCreated:*` event for the configured
   bucket; the object key is URL-decoded (with `+` as space) and MUST
   be a safe object key; the event id is taken from the request id or,
   failing that, the sequencer. Records failing any check are reported
   `invalid_event` and MUST NOT mutate state. Event ids MUST be used to
   deduplicate deliveries (at-least-once transport is assumed).
2. **Completion hints** (`eventType: "upload.completed"`), delivered by
   the publisher over the completion-hint route (Section 6.6.3),
   carrying `slotId` and `objectKey`.

Precedence of upload evidence, in decreasing order of authority:

1. A provider observation of the object (`HeadObject`) — always
   authoritative for size, content type, and etag.
2. An object-created event — a trigger that identifies the key; the
   coordinator still observes the object before committing.
3. A completion hint — a trigger only; a hint with no observable
   object leaves the slot awaiting its object and MUST NOT commit.

When both a hint and an observation exist and their object keys
disagree, the evidence is conflicting and MUST be rejected with
`olos.key_mismatch`. Both events and hints route into the same
verify-then-commit path; neither bypasses observation.

## 7.5 Object-key derivation

<!-- olos-conformance: 7.5 OBJ-LAYOUT-001 -->

The coordinator derives every object key; publishers MUST NOT choose
keys (Section 6.5.1). Keys are built from a prefix (default `media`,
leading/trailing slashes trimmed), the rendition id, and a kind-specific
file name. With `<p>` the prefix, `<rid>` the rendition id, `<msn>` the
media sequence number, `<n>` the part number, and `<ext>` the
extension:

| Kind | Without nonce | With nonce |
| --- | --- | --- |
| `init` | `<p>/<rid>/init.<ext>` | `<p>/<rid>/init-<nonce>.<ext>` |
| `segment` | `<p>/<rid>/s<msn>.<ext>` | `<p>/<rid>/s<msn>-<nonce>.<ext>` |
| `part` | `<p>/<rid>/s<msn>/p<n>.<ext>` | `<p>/<rid>/s<msn>/p<n>-<nonce>.<ext>` |

Default extensions: `mp4` for `init`, `m4s` for `segment` and `part`.
A supplied extension override MUST be a safe path segment and MUST be
in the supported set for the kind (`init`: `.mp4`; `segment`/`part`:
`.m4s`). Leading dots on the extension are stripped.

Every object key — derived or received on the wire — MUST satisfy the
path-safety rules: non-empty; no leading or trailing `/`; no empty,
`.`, or `..` segments; no control characters; no `?` or `#`. Keys
failing these rules MUST be rejected wherever they appear.

The delivery URL for an object is the session's `mediaBaseUrl` with
`/<objectKey>` appended to its path; any query or fragment on the base
URL is dropped.

## 7.6 Object-key nonce

The nonce makes future object URLs unguessable in direct-public mode.

- Format: `<prefix>_<hex>`, default prefix `slot`, where `<hex>` is
  the lowercase hexadecimal encoding of the random bytes. The prefix
  MUST be a URL-safe identifier.
- Entropy: at least 16 random bytes (32 hex characters).
- When `publicationMode` is `direct-public` and the slot-issue payload
  supplies no `objectKeyNonce`, the coordinator MUST generate a fresh
  16-byte nonce per slot. For `read-gated` and
  `private-upload-public-promotion` deployments nonce policy is the
  publisher's responsibility and the nonce MAY be omitted.

## 7.7 Provider capability document

<!-- olos-conformance: 7.7 OBJ-GRANT-004 OBJ-GRANT-005 -->

Each provider is described by a capability document ("OLOS
ProviderCapabilityDocument", Appendix A) with `olos: "1.0"`,
`providerId`, `kind: "object-store"`, and the `consistency`,
`publication`, `uploadGrants`, `delivery`, and optional `events` and
`api` sections. Coordinators MUST evaluate the document before issuing
grants. Unless a deployment explicitly waives a check, a grant MUST NOT
be issued unless:

- `uploadGrants.presignedPut`, `uploadGrants.exactKey`,
  `uploadGrants.methodBound`, `uploadGrants.contentTypeBound`,
  `uploadGrants.requiredHeadersCanBeSigned`, and
  `uploadGrants.objectSizeCanBeObserved` are all `true`;
- `publication.createIfAbsent` is `true`;
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
mode. In `direct-public` mode the public delivery URL is derived from
`delivery.publicBaseUrl` plus the object key, and publication is
manifest-gated: an object becomes part of the stream only when the
committed window references it, even though its bytes may be readable
earlier (Section 10.1). Read-gated and promotion modes keep the
committed delivery URL behind the provider's read gate or promotion
step; commits in a mode the provider does not support MUST be rejected.

## 7.9 End-to-end upload flow

<!-- olos-conformance: 7.9 OBJ-FLOW-001 OBJ-FLOW-002 OBJ-FLOW-003 -->

The normative sequence for one media object:

1. Publisher requests a slot (+ grant) — Sections 6.5.1 / 6.6.1.
2. Publisher `PUT`s the bytes to `grant.url` with every
   `requiredHeaders` entry, before `grant.expiresAt`.
3. The coordinator learns of the upload via completion hint, provider
   event, or reconciliation.
4. The coordinator observes the object (Section 7.3), validates it
   against the slot (key, content type, size bounds), and commits it,
   advancing the cursor and committed window (Sections 4 and 5).

Steps 3 and 4 are idempotent: any combination of hint, event, and
reconciliation for the same upload MUST converge on exactly one commit
(duplicates are `idempotent`, conflicting duplicates are rejected).

## 7.10 Byterange aggregation service

Deployments that address parts by byterange within a virtual segment
(Section 8.5) MUST serve Range requests over the aggregate of the
committed parts whose `byterange.segmentObjectKey` names the requested
virtual segment, concatenated in offset order. Behavior:

| Request | Status | Headers | Body |
| --- | --- | --- | --- |
| No range | `200` | no `content-range` / `content-length` | full aggregate, streamed |
| Open-ended (`start` only) | `200` | no `content-range` / `content-length` | bytes from `start`, streamed live |
| Bounded (`start`–`end`) | `206` | `content-range: bytes <start>-<end>/*`, `content-length` | exactly the promised bytes |
| Negative `start`, or `end < start` | `416` | — | — |
| Unknown session or no cursor | `404` | — | — |

All success responses carry `accept-ranges: bytes`,
`cache-control: no-store`, and `content-type: video/mp4`.

- Bounded responses use the RFC 9110 `content-range` form with an
  unknown complete length (`bytes <first>-<last>/*`), because the
  virtual segment is still growing.
- Open-ended responses MUST NOT carry `content-range` or
  `content-length` (RFC 9110 requires a last-byte-pos, which is
  unknown for a live aggregate); they are `200`, not `206`.
- When a requested range extends past the committed bytes, the service
  SHOULD hold the response open and continue streaming as new parts
  commit (bounded by a wait timeout, default 3000 ms). This is the
  transport for `EXT-X-PRELOAD-HINT` (Section 8.5).
- Fail-fast: if a part object returns no body, or returns zero bytes
  for a requested range, the service MUST error the response stream
  rather than emit silently truncated media.
- Short supply on a bounded range: once `206` with `content-length`
  has been sent, a supply shortfall MUST surface as a mid-stream error
  (aborted transfer), never as a silently short but cleanly closed
  body.
