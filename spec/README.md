# OLOS Specification

This directory contains the specification for OLOS (Open Live Object
Streaming), wire version `1.0`.

OLOS is a protocol for live adaptive media in which encoded media is
published as immutable, time-indexed CMAF objects on S3-compatible object
stores and exposed to viewers through LL-HLS with blocking reload. A
coordinator turns exact-key object uploads into stream state; only committed
media is rendered into manifests.

## Status

This specification is a **draft**. The authoritative status string is the
`OLOS_SPEC_STATUS` constant exported from `olos/src/index.ts` in the
reference implementation; the text in this directory mirrors that constant
and is superseded by it whenever the two disagree. The wire version is the
`OLOS_WIRE_VERSION` constant (`"1.0"`), carried by every session and cursor
in the `olos` field.

While the specification is in draft, the reference implementation
(`@arsenstorm/olos`), its JSON Schemas (`@arsenstorm/olos/schema`), and its
conformance assertions (`@arsenstorm/olos/conformance`) remain the normative
surface. Where this text and the reference implementation disagree, the
implementation wins and the text has a bug.

## Scope

The specification defines:

- the wire objects exchanged between publishers, coordinators, and viewers;
- the state machine that turns uploads into committed stream state;
- the committed-window invariants that gate what viewers can see;
- the HTTP API, the S3-compatible storage binding, the LL-HLS mapping, and
  the direct-public security profile.

Authentication, authorization, tenant quotas, storage-backend selection, and
viewer routing are application concerns and are out of scope (see
Section 02).

## Conformance levels

Conformance assertions are grouped into five levels, mirroring the
`OlosConformanceLevel` type in `olos/src/conformance/metadata.ts`:

| Level      | Meaning                                                        |
| ---------- | -------------------------------------------------------------- |
| `core`     | Protocol-essential commit semantics: slots, observations,      |
|            | commits, cursors, the committed window. Media-agnostic.        |
| `runtime`  | Operational glue: HTTP handlers, heartbeats, health,           |
|            | retention, reconciliation, publisher loops.                    |
| `object`   | The S3-compatible object binding: grants, layout, events,      |
|            | publication flow, delivery caching.                            |
| `hls`      | The LL-HLS profile: playlist rendering, blocking reload,       |
|            | byterange parts, audio groups, end-of-stream.                  |
| `security` | The direct-public deployment profile: origin allow-lists,      |
|            | unguessable keys, response-header policy.                      |

Assertion identifiers prefixed `CORE-RUNTIME-` are historical; the level
recorded in the coverage table is authoritative, not the prefix.

## Reading order

| Section                                                    | Contents |
| ---------------------------------------------------------- | -------- |
| [01 Conventions](./01-conventions.md)                      | Keywords, terminology |
| [02 Architecture](./02-architecture.md)                    | Layers, core invariant |
| [03 Data model](./03-data-model.md)                        | Wire objects, errors |
| [04 Lifecycle](./04-lifecycle.md)                          | State machine |
| [05 Committed window](./05-committed-window.md)            | Window invariants |
| 06 HTTP API                                                | Routes, envelopes |
| 07 S3 binding                                              | Grants, layout, events |
| 08 HLS mapping                                             | Playlist rendering |
| 09 Retention and reconciliation                            | Pruning, recovery |
| 10 Security                                                | Direct-public profile |
| 11 Versioning                                              | Wire-version policy |

Appendix A (JSON Schemas) and Appendix B (conformance assertion catalogue)
are generated from the reference implementation and MUST NOT be edited by
hand.

## Requirement keywords

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" in this specification are to be interpreted as described in
BCP 14 (RFC 2119, RFC 8174) when, and only when, they appear in all
capitals, as shown here.

## License

This specification is published under the MIT License, the same license as
the repository that contains it.
