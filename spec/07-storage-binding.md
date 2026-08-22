# 7. Storage binding contract

OLOS stores committed objects as immutable objects in an object store.
This section is the abstract contract that a storage binding MUST
satisfy. A storage binding is a storage provider together with its
coordinator integration. The contract names operations and guarantees.
It does not define a wire protocol. A store carries OLOS when it
creates an object at an exact key, refuses to overwrite it, reads
properties back, and echoes attached metadata. The contract
is profile-agnostic. It carries the Core coordinates (track, sequence
number, part number) and the opaque `profile` data of slots and
commits without interpreting them. Appendix C gives the S3-compatible
mapping of this contract.

## 7.1 Provider requirements

A binding provides three operations to the coordinator:

- **issue** an upload grant for a slot (Section 7.2),
- **observe** an object by key (Section 7.3),
- **notify** the coordinator that an object was created (Section 7.4).
  This operation is OPTIONAL.

A conforming binding MUST satisfy:

- **Exact-key create-if-absent.** An upload grant addresses exactly
  one object key, the key the coordinator derived (Section 7.5). The
  store MUST refuse a write that addresses any other key. The store
  MUST create the object only when that key does not already exist,
  and MUST fail the upload when it does. Overwrites of live object
  keys are forbidden (Section 10). `uploadGrants.exactKey`,
  `uploadGrants.methodBound`, and `publication.createIfAbsent` declare
  this behavior. `uploadGrants.contentTypeBound` and
  `uploadGrants.requiredHeadersCanBeSigned` declare that the grant
  pins the object's content type and its other required request
  fields.
- **Read-after-create observation.** After an upload succeeds,
  observing the key MUST report the object's size, its content type,
  and the metadata attached at upload time. The store MAY additionally
  report an entity tag and a store-recorded creation or modification
  time. The report MUST be available immediately after the upload
  succeeds, without waiting for propagation.
  `consistency.headAfterCreate: "strong"` and
  `uploadGrants.objectSizeCanBeObserved` declare this behavior.
- **Metadata echo.** The metadata record attached to the object at
  upload time (Section 7.2) MUST come back unchanged from observation,
  apart from the name mapping the binding declares. The coordinator
  uses that record to bind the object back to its slot (Section 7.3).
  The capability document has no separate field for this guarantee. It
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
| `requiredHeaders` | Request headers the uploader MUST send verbatim. Which headers appear is binding-defined. The entries below are REQUIRED of every binding. |
| `expiresAt` | Grant expiry timestamp. |

Requirements:

- The grant MUST address `slot.objectKey` and no other key. How the
  URL encodes the key is binding-defined. The coordinator MUST NOT
  issue a grant whose URL addresses a different key.
- The coordinator MUST issue a grant only for a slot in state
  `issued`.
- `expiresAt` MUST be at or before `slot.expiresAt`. A grant MUST NOT
  outlive its slot.
- The grant MUST bind the upload to the slot's content type
  (`slot.contentType`) and MUST make the write conditional on the key
  not already existing (Section 7.1). The store MUST enforce both
  bindings. An upload that drops or alters them MUST fail.
- The grant MUST cause the upload to attach the **slot binding
  metadata**, a metadata record the store echoes back on observation
  (Section 7.3). The record carries at least the slot id (table
  below).

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
MUST document the mapping. Appendix C gives the S3 mapping. The slot's
`profile` is not written to object metadata. Deployments MAY add extra
required headers or extra metadata. The additions MUST NOT override
the slot binding metadata, under either its abstract names or the
binding's mapped ones.

Uploaders MUST send every `requiredHeaders` entry unchanged. A store
that can validate the grant's fields MUST reject an upload with
missing or altered ones.

## 7.3 Object observation and slot binding

<!-- olos-conformance: 7.3 OBJ-HEAD-001 -->

Before any commit, the coordinator MUST observe the uploaded object
through the binding. The observation is a single read of the object's
properties, `observe(key[, version])`. It names the object key, and
MAY pin a store-assigned version when the store versions objects. It
yields an "OLOS StorageObject" (Appendix A):

| Field | Source | Presence |
| --- | --- | --- |
| `size` | the object's byte length as the store reports it | REQUIRED |
| `contentType` | the content type the store reports | REQUIRED |
| `etag` | the store's entity tag, when it reports one | OPTIONAL |
| `observedAt` | the store-recorded creation or modification time when the store reports one, otherwise the time of the observation request | REQUIRED |
| metadata | the slot binding metadata echoed back (Section 7.2) | REQUIRED when the object carries it |

Observation is the only authority for these values. The coordinator
MUST reject a commit that no observation backs (`olos.invalid_state`,
Section 6.3.1). A publisher-supplied size, content type, or entity tag
is never a substitute. The store-recorded time keeps the slot deadline
(Section 4.5.3) judged against store-observed time. The request's
`committedAt` is the fallback, used when the store records no such
time.

Metadata echo binds the object to its slot. The coordinator reads the
slot id from observed metadata under the canonical name
`x-olos-slot-id`. A binding MAY carry it under a store-specific
spelling, and MUST normalize that spelling to the canonical name
before the coordinator sees it. If observed metadata carries a slot id
that differs from the slot in the commit, the coordinator MUST reject
the commit (`olos.invalid_state`).

## 7.4 Events and completion hints

Two external signals can tell the coordinator that an upload finished:

1. **Object-created events** (`eventType: "object.created"`). A
   store-emitted notification that names an object key in the store
   the binding is configured against. Notifications arrive in the
   store's own format. The binding normalizes each one at the ingress
   boundary. The normalized event carries an event id, the object key,
   and the observed-object fields the store supplies. Normalization MUST
   treat the payload as untrusted. The record MUST name an
   object-creation event for the configured store location, and the
   decoded object key MUST satisfy the path-safety rules of Section
   7.5. A record that fails any check is reported `invalid_event` and
   MUST NOT mutate state. A malformed record MUST NOT invalidate its
   valid siblings. The transport is at-least-once. Deduplication is by
   slot commit state (Section 4.4). A redelivery routes into the
   idempotent observe-then-commit path (Section 7.9) and reports
   `idempotent`. Event ids are informational, and a binding derives
   them from whatever stable identifier the store's notification
   carries. A redelivery for a slot that retention has pruned fails
   per record with `olos.unknown_slot`.
2. **Completion hints** (`eventType: "upload.completed"`). The
   publisher delivers them over the completion-hint route
   (Section 6.6.3) with `slotId` and `objectKey`.

Section 4.4 gives the precedence of upload evidence and the rule for a
hint whose object key disagrees with an observation. Events and hints
route into the same observe-then-commit path. Neither bypasses
observation.

## 7.5 Object-key derivation

<!-- olos-conformance: 7.5 OBJ-LAYOUT-001 -->

The coordinator derives every object key. Publishers MUST NOT choose
keys (Section 6.5.1). The coordinator builds keys from a prefix
(default `objects`), the track id, and a kind-specific file name. In
the table, `<p>` is the prefix, `<tid>` the track id, `<seq>` the
sequence number, and `<n>` the part number. `[-nonce]` is present only
when a nonce is set (Section 7.6). `[.ext]` is present only when an
extension is set.

| Kind | Key |
| --- | --- |
| `init` | `<p>/<tid>/init[-nonce][.ext]` |
| `segment` | `<p>/<tid>/s<seq>[-nonce][.ext]` |
| `part` | `<p>/<tid>/s<seq>/p<n>[-nonce][.ext]` |

The nonce is appended to the file name, after `init`, `s<seq>`, or
`p<n>`, and before the extension. Core defines no default extension.
When the slot-issue payload carries no `extension`, the key has none.
A profile MAY require an extension (Section 8.9.5). An `extension`
received on the wire MUST be a non-empty safe path segment without `/`
or `.`. The coordinator rejects a value that carries a dot with `400`.
It likewise rejects a prefix override with a leading or trailing
slash, or with empty, `.`, or `..` segments.

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
`api.family` names the store API the binding implements, and is how a
deployment tells one binding's documents from another's.

The document describes what a provider can do. A deployment MUST
evaluate it before it configures a coordinator to issue grants for the
provider. If a deployment does not explicitly waive a check, it MUST
NOT configure grant issuance unless:

- `uploadGrants.exactKey`, `uploadGrants.methodBound`,
  `uploadGrants.contentTypeBound`,
  `uploadGrants.requiredHeadersCanBeSigned`, and
  `uploadGrants.objectSizeCanBeObserved` are all `true`.
- the grant-issuance mechanism the binding uses is declared. The
  schema REQUIRES `uploadGrants.presignedPut` or
  `uploadGrants.temporaryCredentials` to be `true`, and the binding
  MUST declare the one it uses. The default check requires
  `presignedPut` (Appendix C). A binding that issues grants the other
  way waives that check.
- `publication.createIfAbsent` is `true`.
- the grant TTL is positive. When the provider declares
  `uploadGrants.maxRecommendedTtlSeconds`, the TTL does not exceed it.

Publication-mode gates:

- `direct-public` REQUIRES `publication.directObjectPublication`,
  `publication.manifestGatedPublication`,
  `delivery.negativeCachingPolicyDeclared`,
  `delivery.documentNavigationCanBeBlocked`, and
  `delivery.immutableCaching` all `true`, and
  `consistency.headAfterCreate: "strong"`. It MUST NOT declare
  `publication.overwritesAllowed: true`.
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
promotion step. A deployment MUST choose a `publicationMode` that the
provider's capability document supports (Section 7.7).

## 7.9 End-to-end upload flow

<!-- olos-conformance: 7.9 OBJ-FLOW-001 OBJ-FLOW-002 OBJ-FLOW-003 -->

The normative sequence for one object:

1. The publisher requests a slot and a grant (Sections 6.5.1 and
   6.6.1).
2. Before `grant.expiresAt`, the publisher uploads the bytes with a
   `grant.method` request to `grant.url`, and sends every
   `requiredHeaders` entry unchanged.
3. The coordinator learns of the upload through a completion hint, a
   store event, or reconciliation (Section 4.4).
4. The coordinator observes the object and matches it against the slot
   (Section 4.4), then commits it (Section 4.5.1). The commit advances
   the cursor and the committed window (Sections 4 and 5).

Steps 3 and 4 are idempotent. Any combination of hint, event, and
reconciliation for the same upload MUST converge on exactly one
commit. Duplicates are `idempotent`. Conflicting duplicates are
rejected.
