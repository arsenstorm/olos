# 2. Architecture

## 2.1 Layer model

OLOS is a layered protocol. Each layer answers a different question and can
be adopted, extended, or replaced independently. A conforming deployment
implements Core, exactly one profile per session, and one storage binding.
The reference implementation ships every layer below.

| Layer                       | Question it answers                          |
| --------------------------- | -------------------------------------------- |
| Core                        | What makes an uploaded object an officially  |
|                             | committed part of the live stream?           |
| Profile                     | What do the objects contain, what do         |
|                             | positions mean, and how is the committed     |
|                             | window rendered for viewers?                 |
| Storage binding             | What is the minimum an object store must     |
|                             | provide, and how does a given store          |
|                             | provide it?                                  |
| Delivery mapping            | How does a profile's rendering reach a       |
|                             | client (for example LL-HLS playlists with    |
|                             | blocking reload)?                            |
| Direct-public deployment    | Under what conditions can committed object   |
| profile                     | bytes be served directly from the delivery   |
|                             | origin?                                      |
| Runtime guidance            | How do heartbeats, retention,                |
|                             | reconciliation, and publisher loops behave?  |

**Core** (Sections 03-05) defines sessions, tracks, slots, observed
uploads, commits, cursors, and the committed window. It is
profile-agnostic. It references no media format, no HLS, no S3, and no
HTTP. Everything normative about what constitutes stream state is defined
here. Core positions are `(epoch, sequenceNumber, partNumber?)`; sequence
numbers are monotonic per track and carry no time meaning in Core.

**Profiles** (Section 8 for the CMAF/LL-HLS profile) sit between Core and
the bindings. A profile is named by the `id` of the session profile. It
defines the contents of every `profile` field, which object kinds are
required (for example init objects), any object-key naming beyond Core's
safety rules, the interpretation of sequence positions, and the rendering
of the committed window. A profile MAY supply a track-window hook that
summarizes a track's visible and trimmed segments into the track window's
`profile` at window build time; Core records what the hook returns. Unless
stated otherwise, "profile" in this specification means this layer, not
the deployment or storage profiles named below.

The rule that keeps Core generic: **Core never inspects `profile` beyond
"a JSON object, with a non-empty string `id` on sessions and cursors"**.
Core validators MUST accept any such object. Core MUST carry profile data
unchanged from the session onto cursors, from the slot and the commit
request onto the commit, and from the commit onto the committed object.
Core MUST NOT derive stream state from the contents of profile data.

**The storage binding** (Section 7) is an abstract contract — exact-key
create-if-absent, read-after-create observation, metadata echo, optional
create events. It names operations and guarantees, not a store API, so
any object store that can satisfy them can carry OLOS. Appendix C
realises the contract on S3-compatible stores (S3, R2, GCS-S3, MinIO). A
store declares what it satisfies in a provider capability document
(Section 3.7).

**The delivery mapping** (Section 8 for LL-HLS) renders a profile's view
of the committed window into client-facing delivery documents. The LL-HLS
mapping renders media and multivariant playlists with blocking reload,
partial segments, byterange parts, and audio groups.

**The direct-public deployment profile** (Section 10) covers deployments
where committed object bytes are served directly from the delivery origin.
It requires a cookieless delivery origin, declared negative caching for
missing objects, and no document navigation to object URLs. The rendered
delivery document is the gate.

**Runtime guidance** (Sections 06 and 09) covers publisher leases and
heartbeats, retention, reconciliation, live health, and publisher loops.
This operational behavior surrounds the protocol-essential commit
semantics but is not part of them.

Layers depend downward only. A profile builds on Core. A delivery mapping
builds on its profile. Core never builds on a profile, a binding, or a
mapping. Core state and validation rules MUST NOT depend on any specific
profile, storage provider, or playback format.

## 2.2 Responsibility split

OLOS specifies:

- slot issuance rules, slot and session state machines
- upload observation and commit acceptance, including idempotency
- cursor sequencing and committed-window invariants
- object-key and delivery-URL safety rules
- the profile contract, and the CMAF/LL-HLS profile with its LL-HLS
  rendering, the blocking-reload boundary, and retention planning
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
- Delivery documents MUST be rendered exclusively from the committed window
  carried by the cursor. An uploaded but uncommitted object MUST NOT appear
  in any delivery document, cursor, or committed window.
- As a result, an upload that is never committed is inert. It consumes
  storage until retention deletes it, but it has no protocol-visible
  effect.

Because of this invariant, object bytes can travel through untrusted,
eventually-visible object storage while stream state remains exact. The
rendered delivery document (in the CMAF/LL-HLS profile, the manifest) is
the gate.
