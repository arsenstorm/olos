# 1. Conventions and terminology

## 1.1 Requirement keywords

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" in this document are to be interpreted as described in BCP 14
(RFC 2119, RFC 8174) when, and only when, they appear in all capitals, as
shown here.

## 1.2 Data conventions

- **Timestamps.** Every timestamp field carries an RFC 3339 `date-time`
  string: full date, `T` separator, full time, and a `Z` or numeric UTC
  offset. Values that match the shape but denote impossible calendar dates
  are invalid. Leap seconds (`:60`), the hour `24`, and a space separator
  are invalid.
- **Identifiers.** Every identifier field is a non-empty string restricted
  to the URL-safe alphabet `A-Z a-z 0-9 . _ -`. The identifier fields are
  `sessionId`, `slotId`, `commitId`, `trackId`, `providerId`, event
  identifiers, and profile-defined identifiers such as the CMAF/LL-HLS
  `groupId`.
- **Durations** are positive JSON numbers in seconds. If a field name
  carries an explicit `Ms` (milliseconds) suffix, the value is in
  milliseconds. Core wire objects carry no durations of their own. A
  profile that needs them defines them inside its profile data.
- **Byte sizes** (`size`, `minBytes`, `maxBytes`, byterange `offset` and
  `length`) are JSON integers. Fractional byte counts are invalid. Every
  integer field is a safe integer (at most 2^53 - 1). Larger values are
  invalid.
- **Profile data.** Every `profile` field is a JSON object that Core
  treats as opaque (Section 2.1).
- **Unknown fields.** Wire objects are closed on the write path. A
  coordinator MUST reject an inbound payload, or a stored document it
  re-validates, that carries a property not defined for that object.
  Profile data is exempt, because keys inside a `profile` object are never
  unknown to Core. Clients MUST ignore unknown fields in responses and
  stored documents they read. That tolerance makes additive response
  fields non-breaking (Section 11.2).

## 1.3 Terminology

This specification uses the terms below with exactly these meanings. Media
terms appear only as examples drawn from the CMAF/LL-HLS profile
(Section 8). Core attaches no media meaning to any term.

Reference implementation (informative): `olos/src/types/`.

**session.** The unit of one live stream, identified by `sessionId`, and
the scope of every slot, commit, cursor, and delivery document. A session
declares the wire version, an epoch, its profile, its tracks, and a
lifecycle state (`live`, `ending`, `ended`, or `aborted`).

**epoch.** A generation counter (a non-negative integer) carried by a
session and inherited by every slot, commit, committed window, and cursor
derived from it. Positions in different epochs are ordered by epoch first,
so any position in a later epoch supersedes every position in an earlier
one.

**track.** One ordered stream of objects within a session, identified by
`trackId`, with its own timeline of sequence positions. In the CMAF/LL-HLS
profile a track is one encoded variant, with a kind, a codec, and optional
characteristics.

**sequence number.** The non-negative integer index of a segment position
on a track timeline. The index increases monotonically within a track.
Core gives sequence numbers no time meaning and relates none across
tracks, but a profile MAY add meaning (Section 8).

**segment.** The object, or the set of parts, at one sequence position on
a track. A position is visible with a full segment object, with a
contiguous prefix of parts, or with both (Section 5).

**part.** A sub-segment object addressed by a sequence number plus a
non-negative `partNumber` within that segment. Parts are numbered from 0.
A part makes a position visible before the full segment exists, and MAY be
a byte range into a virtual segment object.

**init object.** A track's OPTIONAL initialization object, published at
most once per track and epoch under the slot kind `init`. Core requires
none, and a profile MAY require one (the CMAF/LL-HLS profile requires one
per track and renders it as `EXT-X-MAP`).

**profile.** The layer that gives Core objects their meaning, named by an
identifier (for example `cmaf-llhls`). A profile defines its profile data,
how it interprets positions, which objects it requires, object-key naming
beyond Core's safety rules, and window rendering (Section 8).

**profile data.** The contents of a `profile` field on a track, upload
slot, commit, committed object, or track window. Core carries it unchanged
(Section 2.1).

**session profile.** The REQUIRED `profile` object of a session, whose
`id` names the profile. The coordinator copies it unchanged onto every
cursor of the session.

**upload slot.** A single-use, coordinator-issued reservation for exactly
one object at one position. A slot moves through the states `issued`,
`upload_observed`, `committed`, `expired`, `rejected`, and `revoked`
(Section 4.3).

**upload grant.** The credential that lets a publisher upload the object
that a slot reserves. A grant references its slot by `slotId` and carries
no authority beyond that single exact-key upload.

**observed upload.** Evidence, trusted by the coordinator, that an object
now exists in storage. Evidence comes from a storage read or from a
provider `object.created` event (Section 4.4).

**commit.** The wire object that makes one observed upload part of stream
state. Only an accepted commit changes what viewers can see.

**cursor.** The coordinator's authoritative description of the live edge
of a session. The cursor advances monotonically and carries the session
state, the session profile, the delivery base URL, and the current
committed window.

**committed window.** The retained, viewer-visible span of committed
objects. The window carries an epoch and is bounded by a first and last
sequence number. Renderers render delivery documents only from the
committed window (Section 5).

**delivery base URL.** The `deliveryBaseUrl` of a cursor, the safe
delivery URL against which relative delivery URLs in the committed window
resolve. In the direct-public profile the URL is rooted at the object
store's public endpoint, or at a CDN in front of that endpoint.

**delivery origin.** The HTTP origin (or origins) from which committed
objects are served to viewers, rooted at the delivery base URL.

**coordinator.** The component that owns session state and is the single
writer of it. The coordinator issues slots, matches observed uploads
against their slots, accepts or rejects commits, advances the cursor,
maintains publisher leases, and plans retention.

**publisher.** The component that produces objects. The publisher creates
the session, requests slots, uploads objects under the granted keys, posts
commits, and maintains its lease through heartbeats.

**viewer.** A consumer of the stream. The viewer fetches delivery
documents rendered from the committed window, and objects from the
delivery origin. A viewer never observes uncommitted objects through the
protocol.

**delivery URL.** The reference under which a committed object is
addressed in delivery documents, either an absolute HTTP(S) URL or a safe
relative path. In both cases the URL contains no query strings, fragments,
control characters, `.` or `..` segments, or empty path segments.

**object key.** The storage-relative name of an object. Object keys MUST
be safe relative keys, with the layout defined in Section 7.5 and the
optional nonce in Section 7.6.

**wire version.** The value of the `olos` field (`"1.0"`) carried by
sessions, cursors, and provider capability documents. Section 11 defines
versioning policy.
