# OLOS Specification

This directory contains the specification for OLOS (Open Live Object
Streaming), wire version `1.0`.

OLOS is a protocol for live object streaming over commodity object
storage. A publisher uploads immutable objects to an S3-compatible store
under coordinator-issued keys. A coordinator turns those exact-key uploads
into an ordered, committed, retained sequence of objects and publishes a
cursor that describes the live edge. Viewers consume only committed
objects. What the objects contain, and how the committed sequence is
rendered for playback, is defined by a **profile**. The CMAF/LL-HLS
profile (`cmaf-llhls`) is the first profile: it carries CMAF media and
renders the committed window as LL-HLS playlists with blocking reload.

## Status

This specification is a **draft**, at status `draft-v1.0.0`, wire version
`1.0`. The wire version is carried in the `olos` field of every session and
cursor. This text is normative.

`@arsenstorm/olos` is the reference implementation. Together with its JSON
Schemas (`@arsenstorm/olos/schema` for Core and `@arsenstorm/olos/media`
for the CMAF/LL-HLS profile) and its conformance catalogue
(`@arsenstorm/olos/conformance`), it is informative. Where the
implementation, its schemas, or its conformance catalogue disagree with
this text, the text governs and the implementation has a bug. The
constants `OLOS_SPEC_STATUS` and `OLOS_WIRE_VERSION` that the
implementation exports from `olos/src/index.ts` mirror this text.

## Scope

The specification defines:

- the profile-opaque Core wire objects exchanged between publishers,
  coordinators, and viewers
- the state machine that turns uploads into committed stream state
- the committed-window invariants that gate what viewers can see
- the profile contract: what a profile defines and how Core carries
  profile data unchanged
- the CMAF/LL-HLS profile, the first profile, together with its LL-HLS
  delivery mapping
- the HTTP API, the S3-compatible storage binding, and the direct-public
  security profile

Authentication, authorization, tenant quotas, storage-backend selection, and
viewer routing are application concerns. They are out of scope (see
Section 2).

## Conformance levels

Conformance assertions are grouped into five levels. The reference
implementation's `OlosConformanceLevel` type mirrors these levels
(informative):

| Level      | Meaning                                                        |
| ---------- | -------------------------------------------------------------- |
| `core`     | Protocol-essential commit semantics: slots, observations,      |
|            | commits, cursors, the committed window. Profile-agnostic.      |
| `runtime`  | Operational glue: HTTP handlers, heartbeats, health,           |
|            | retention, reconciliation, publisher loops.                    |
| `object`   | The storage binding contract (Section 7): grants, layout,      |
|            | observation, events, publication flow.                         |
| `hls`      | The CMAF/LL-HLS profile: profile data, playlist rendering,     |
|            | blocking reload, byterange parts, audio groups, end-of-stream. |
| `security` | The direct-public deployment profile: origin allow-lists,      |
|            | unguessable keys, response-header policy.                      |

Assertion identifiers with the prefix `CORE-RUNTIME-` are historical. The
level recorded in the coverage table is authoritative. The prefix is not
authoritative.

## Reading order

| Section                                                                      | Contents |
| ---------------------------------------------------------------------------- | -------- |
| [1. Conventions and terminology](./01-conventions.md)                        | Keywords, terminology |
| [2. Architecture](./02-architecture.md)                                      | Layers, profiles, core invariant |
| [3. Data model](./03-data-model.md)                                          | Core wire objects, errors |
| [4. Lifecycle](./04-lifecycle.md)                                            | State machine |
| [5. Committed window](./05-committed-window.md)                              | Window invariants |
| [6. HTTP API](./06-http-api.md)                                              | Routes, envelopes |
| [7. Storage binding contract](./07-storage-binding.md)                      | Exact-key grants, observation, events, layout |
| [8. CMAF/LL-HLS profile](./08-hls-mapping.md)                                | Profile data, playlist rendering |
| [9. Retention and reconciliation](./09-retention-reconciliation.md)          | Pruning, recovery |
| [10. Security profile: direct-public deployment](./10-security.md)           | Direct-public profile |
| [11. Versioning and compatibility](./11-versioning.md)                       | Wire-version and profile policy |

Appendix A (JSON Schemas: A.1 Core, A.2 the CMAF/LL-HLS profile) and
Appendix B (conformance assertion catalogue) are generated from the
reference implementation and are informative reproductions of the
normative text's schemas and assertion catalogue. They MUST NOT be edited
by hand. Appendix C ([S3-compatible storage binding](./appendix-c-s3-binding.md))
realises Section 7 on S3-compatible stores.

## Requirement keywords

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" in this specification are to be interpreted as described in
BCP 14 (RFC 2119, RFC 8174) when, and only when, they appear in all
capitals, as shown here.

## License

This specification is published under the MIT License, the same license as
the repository that contains it.
