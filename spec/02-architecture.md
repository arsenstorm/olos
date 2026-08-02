# 02 Architecture

## 2.1 Layer model

OLOS is a layered protocol. Each layer answers a different question and can
be adopted, extended, or replaced independently. A conforming deployment
implements Core and at least one delivery profile; the reference
implementation ships all five layers.

| Layer                       | Question it answers                          |
| --------------------------- | -------------------------------------------- |
| Core                        | What makes an uploaded object an officially  |
|                             | committed part of the live stream?           |
| LL-HLS profile              | How does the committed window render into a  |
|                             | playable LL-HLS manifest with blocking       |
|                             | reload?                                      |
| S3-compatible binding       | What is the minimum a storage backend must   |
|                             | provide?                                     |
| Direct-public profile       | Under what conditions may committed media    |
|                             | bytes be served directly from the media      |
|                             | origin?                                      |
| Runtime guidance            | How do heartbeats, retention,                |
|                             | reconciliation, and publisher loops behave?  |

**Core** (Sections 03-05) defines slots, observed uploads, commits,
cursors, and the committed window. It is media-agnostic: no HLS, no S3, no
HTTP. Everything normative about what constitutes stream state lives here.

**The LL-HLS profile** (Section 08) renders the committed window into
media and multivariant playlists with blocking reload, partial segments,
byterange parts, and audio groups.

**The S3-compatible binding** (Section 07) specifies the minimum storage
contract: exact-key uploads, conditional create, `HeadObject` consistency,
and optional event notifications. Any S3-compatible store (S3, R2, GCS-S3,
MinIO) can satisfy it; a store declares what it satisfies in a provider
capability document (Section 3.7).

**The direct-public deployment profile** (Section 10) covers deployments
where committed media bytes are served directly from the media origin. It
requires a cookieless media origin, declared negative caching for missing
objects, and no document navigation to media URLs. The manifest is the
gate.

**Runtime guidance** (Sections 06 and 09) covers publisher leases and
heartbeats, retention, reconciliation, live health, and publisher loops —
operational behavior that surrounds, but is not part of, the
protocol-essential commit semantics.

Layers depend downward only: a delivery profile builds on Core, never the
reverse. Core state and validation rules MUST NOT depend on any specific
storage provider or playback format.

## 2.2 Responsibility split

OLOS specifies:

- slot issuance rules, slot and session state machines;
- upload observation and commit acceptance, including idempotency;
- cursor sequencing and committed-window invariants;
- object-key and delivery-URL safety rules;
- manifest rendering, the blocking-reload boundary, and retention
  planning;
- the error envelope and error-code registry;
- the conformance assertion catalogue.

The application owns:

- authentication and authorization of publishers and viewers;
- the coordinator store backend and its durability;
- storage credentials and provider selection;
- the cursor wake-up mechanism, publisher scheduling, and viewer routing;
- cache purging, tenant quotas, and abuse controls.

An implementation MAY add application policy at the extension points the
protocol defines (for example, a commit policy hook that rejects a
candidate commit before acceptance), but application policy MUST NOT relax
any requirement stated in this specification.

## 2.3 The core invariant

An object existing in storage is not the same as an object being part of
stream state.

- An implementation MUST NOT treat the existence, readability, or
  integrity of an object in storage as making that object part of a
  session's stream state.
- An object becomes part of stream state only when the coordinator accepts
  a commit for the slot that reserved it (Section 4.5).
- Manifests MUST be rendered exclusively from the committed window carried
  by the cursor; an uploaded but uncommitted object MUST NOT appear in any
  manifest, cursor, or committed window.
- Consequently, an upload that is never committed is inert: it consumes
  storage until retention removes it, but it has no protocol-visible
  effect.

This invariant is what allows media bytes to travel through untrusted,
eventually-visible object storage while stream state remains exact: the
manifest is the gate.
