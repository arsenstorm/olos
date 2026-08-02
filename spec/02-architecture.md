# 2. Architecture

## 2.1 Layer model

OLOS is a layered protocol. Each layer answers a different question and can
be adopted, extended, or replaced independently. A conforming deployment
implements Core and at least one delivery profile. The reference
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
| Direct-public profile       | Under what conditions can committed media    |
|                             | bytes be served directly from the media      |
|                             | origin?                                      |
| Runtime guidance            | How do heartbeats, retention,                |
|                             | reconciliation, and publisher loops behave?  |

**Core** (Sections 03-05) defines slots, observed uploads, commits,
cursors, and the committed window. It is media-agnostic. It references no
HLS, no S3, and no HTTP. Everything normative about what constitutes
stream state is defined here.

**The LL-HLS profile** (Section 8) renders the committed window into
media and multivariant playlists with blocking reload, partial segments,
byterange parts, and audio groups.

**The S3-compatible binding** (Section 7) specifies the minimum storage
contract: exact-key uploads, conditional create, `HeadObject` consistency,
and optional event notifications. Any S3-compatible store (S3, R2, GCS-S3,
MinIO) can satisfy it. A store declares what it satisfies in a provider
capability document (Section 3.7).

**The direct-public deployment profile** (Section 10) covers deployments
where committed media bytes are served directly from the media origin. It
requires a cookieless media origin, declared negative caching for missing
objects, and no document navigation to media URLs. The manifest is the
gate.

**Runtime guidance** (Sections 06 and 09) covers publisher leases and
heartbeats, retention, reconciliation, live health, and publisher loops.
This operational behavior surrounds the protocol-essential commit
semantics but is not part of them.

Layers depend downward only. A delivery profile builds on Core. Core never
builds on a delivery profile. Core state and validation rules MUST NOT
depend on any specific storage provider or playback format.

## 2.2 Responsibility split

OLOS specifies:

- slot issuance rules, slot and session state machines
- upload observation and commit acceptance, including idempotency
- cursor sequencing and committed-window invariants
- object-key and delivery-URL safety rules
- manifest rendering, the blocking-reload boundary, and retention
  planning
- the error envelope and error-code registry
- the conformance assertion catalogue

The application owns:

- authentication and authorization of publishers and viewers
- the coordinator store backend and its durability
- storage credentials and provider selection
- the cursor wake-up mechanism, publisher scheduling, and viewer routing
- cache purging, tenant quotas, and abuse controls

An implementation MAY add application policy at the extension points that
the protocol defines (for example, a commit policy hook that rejects a
candidate commit before acceptance). Application policy MUST NOT relax
any requirement stated in this specification.

## 2.3 The core invariant

That an object exists in storage does not mean that the object is part of
stream state.

- The existence, readability, or integrity of an object in storage MUST
  NOT make that object part of a session's stream state.
- An object becomes part of stream state only when the coordinator accepts
  a commit for the slot that reserved it (Section 4.5).
- Manifests MUST be rendered exclusively from the committed window carried
  by the cursor. An uploaded but uncommitted object MUST NOT appear in any
  manifest, cursor, or committed window.
- As a result, an upload that is never committed is inert. It consumes
  storage until retention deletes it, but it has no protocol-visible
  effect.

Because of this invariant, media bytes can travel through untrusted,
eventually-visible object storage while stream state remains exact. The
manifest is the gate.
