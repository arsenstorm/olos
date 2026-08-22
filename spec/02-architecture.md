# 2. Architecture

## 2.1 Layer model

OLOS is a layered protocol. Each layer answers a different question and can
be adopted, extended, or replaced independently. A conforming deployment
implements Core, exactly one profile per session, and one storage binding.

| Layer                       | Question it answers                          |
| --------------------------- | -------------------------------------------- |
| Core (Sections 3 to 5)      | What makes an uploaded object a committed    |
|                             | part of the live stream?                     |
| Profile (Section 8 defines  | What do the objects contain, what do         |
| the CMAF/LL-HLS profile)    | positions mean, and how is the committed     |
|                             | window rendered for viewers?                 |
| Storage binding (Section 7) | What is the minimum an object store must     |
|                             | provide, and how does a given store          |
|                             | provide it?                                  |
| Delivery mapping            | How does a profile's rendering reach a       |
| (Section 8)                 | client (for example LL-HLS playlists with    |
|                             | blocking reload)?                            |
| Direct-public deployment    | Under what conditions can committed object   |
| profile (Section 10)        | bytes be served directly from the delivery   |
|                             | origin?                                      |
| Runtime guidance            | How do heartbeats, retention,                |
| (Sections 6 and 9)          | reconciliation, and publisher loops behave?  |

Unless stated otherwise, "profile" in this specification means the profile
layer. Layers depend downward only. A profile builds on Core, and a
delivery mapping builds on its profile. Core state and validation rules
MUST NOT depend on any profile, storage provider, or playback format. Core
treats every `profile` field as an opaque JSON object, and validates only
that shape plus a non-empty string `id` on sessions and cursors. Core
validators MUST accept any such object, and MUST NOT reject, rewrite, or
reorder its remaining contents. Core MUST carry profile data unchanged
from the session onto cursors. Core MUST also carry it unchanged from the
slot and the commit request onto the commit, and from the commit onto the
committed object. Core MUST NOT derive stream state from the contents of
profile data.

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
the protocol defines (for example, a commit policy hook). Application
policy MUST NOT relax any requirement stated in this specification.

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
eventually-visible object storage while stream state remains exact.
