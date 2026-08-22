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
  are invalid.
- **Identifiers.** Every identifier field (`sessionId`, `slotId`,
  `commitId`, `trackId`, `providerId`, event identifiers, and
  profile-defined identifiers such as the CMAF/LL-HLS `groupId`) is a
  non-empty string restricted to the URL-safe alphabet
  `A-Z a-z 0-9 . _ -`.
- **Durations** are positive JSON numbers in seconds. If a field name
  carries an explicit `Ms` (milliseconds) suffix, the value is in
  milliseconds. Core wire objects carry no durations of their own; a
  profile that needs them defines them inside its profile data.
- **Byte sizes** (`size`, `minBytes`, `maxBytes`, byterange `offset` and
  `length`) are JSON integers. Fractional byte counts are invalid.
- **Profile data.** Every `profile` field is a JSON object. Core validates
  only that shape (and, on sessions and cursors, a non-empty string `id`).
  Core MUST NOT reject, rewrite, or reorder the remaining contents. The
  owning profile defines and validates them (Section 2.1, Section 3.1).
- **Unknown fields.** Wire objects are closed on the write path: a
  coordinator MUST reject an inbound payload, or a stored document it
  re-validates, that carries a property not defined for that object.
  Profile data is exempt: keys inside a `profile` object are never
  unknown to Core. Clients MUST instead ignore unknown fields in
  responses and stored documents they read — that tolerance is what makes
  additive response fields non-breaking (Section 11.2).

## 1.3 Terminology

This specification uses the terms below with exactly these meanings. The
definitions derive from the reference implementation's public types
(`olos/src/types/`). Media terms appear only as examples drawn from the
CMAF/LL-HLS profile (Section 8); Core attaches no media meaning to any
term.

**session** — the unit of one live stream. A session is a wire object
identified by `sessionId`. It declares the wire version, an epoch, the
profile it runs under, a set of tracks, and a lifecycle state (`live`,
`ending`, `ended`, or `aborted`). All slots, commits, cursors, and rendered
delivery documents are scoped to a session.

**epoch** — a non-negative integer generation counter carried by a session
and inherited by every upload slot, commit, committed window, and cursor
derived from it. Positions in different epochs are ordered by epoch first.
Any position in a later epoch supersedes every position in an earlier one.

**track** — one ordered stream of objects within a session, identified by
`trackId` within the session. Core identifies a track and, optionally,
records the default content type of its objects. What the objects contain
is profile data: in the CMAF/LL-HLS profile a track is one encoded
variant of the media, with a kind (`audio`, `video`, `text`, or
`metadata`), a codec, and optional characteristics. Each track has its own
timeline of segments inside the committed window.

**sequence number** — the non-negative integer index of a segment position
on a track timeline. Sequence numbers increase monotonically within a
track. Core gives a sequence number no time meaning and does not relate
sequence numbers on different tracks. A profile MAY add meaning: the
CMAF/LL-HLS profile aligns sequence numbers across tracks, so that the same
sequence number denotes the same time-aligned segment position in every
track, and maps it to the HLS media sequence number.

**segment** — the object, or the set of parts, at one sequence position on
a track. A position is visible with a full segment object, with a
contiguous prefix of parts, or with both (Section 5).

**part** — a sub-segment object addressed by a sequence number plus a
non-negative `partNumber` within that segment. Parts make a position
visible before the full segment exists. Parts are numbered from 0 and MAY
be expressed as byte ranges into a virtual segment object.

**init object** — a track's OPTIONAL initialization object, published at
most once per track and epoch under the slot kind `init`. Core does not
require one. A profile MAY require it: the CMAF/LL-HLS profile requires an
init object per track and renders it as `EXT-X-MAP`.

**profile** — the layer that gives Core objects their meaning. A profile
is named by an identifier (for example `cmaf-llhls`). It defines what its
profile data contains on sessions, tracks, slots, commits, committed
objects, and track windows; how sequence positions are interpreted; which
objects are required; how object keys are named beyond Core's safety rules;
and how the committed window is rendered for delivery. Section 8 defines
the CMAF/LL-HLS profile.

**profile data** — the contents of a `profile` field on a track, upload
slot, commit, committed object, or track window. Profile data is a JSON
object that Core carries unchanged. Its contents are defined by the
session's profile (Section 1.2).

**session profile** — the `profile` object of a session. It is REQUIRED,
its `id` names the profile, and every other key belongs to that profile.
The coordinator copies the session profile unchanged onto every cursor of
the session. In the CMAF/LL-HLS profile it carries the segment and part
duration targets.

**upload slot** — a single-use, coordinator-issued reservation for exactly
one object. It fixes the object key, delivery URL, content type, kind
(`init`, `part`, or `segment`), position (sequence number and optional
part number), byte-size bounds, an expiry deadline, and OPTIONAL profile
data stating the issuer's expectations for the object. A slot moves
through the states `issued`, `upload_observed`, `committed`, `expired`,
`rejected`, and `revoked` (Section 4.3).

**upload grant** — the credential that lets a publisher perform the upload
that a slot reserves. A grant carries an HTTP `PUT` URL (typically
presigned), an expiry timestamp, and any headers that the upload request
must carry. A grant references its slot by `slotId`. It grants no authority
beyond that single exact-key upload.

**observed upload** — evidence, trusted by the coordinator, that an object
now exists in storage. The evidence carries the object key, content type,
size, optional etag and metadata, the observing provider, and the
observation time. Evidence comes from a storage read (for example
`HeadObject`) or from a provider `object.created` event. After a publisher
completion hint, the coordinator awaits such evidence (Section 4.4).

**commit** — the wire object that makes one observed upload part of stream
state. It binds a `commitId` to the slot's position, object key, and
delivery URL, the observed size and etag, and the object's profile data.
Only an accepted commit changes what viewers can see.

**cursor** — the coordinator's authoritative description of the live edge
of a session. The cursor advances monotonically. It carries the wire
version, session state, epoch, the session profile, the delivery base URL,
and the current committed window. It also carries the window's first and
last sequence number plus the last visible part number.

**committed window** — the retained, viewer-visible span of committed
objects. The window carries, per track, an OPTIONAL init object, OPTIONAL
profile data, and an ordered segment list. The window is bounded by a
first and last sequence number and carries an epoch. Only content in the
committed window is rendered for delivery (Section 5).

**delivery base URL** — the `deliveryBaseUrl` of a cursor: the safe
delivery URL against which relative delivery URLs in the committed window
resolve. In the direct-public profile it is rooted at the object store's
public endpoint or a CDN in front of it.

**delivery origin** — the HTTP origin (or origins) from which committed
objects are served to viewers, rooted at the delivery base URL.

**coordinator** — the component that owns session state. It issues slots,
matches observed uploads against their slots, accepts or rejects commits,
advances the cursor, maintains publisher leases, and plans retention. The
coordinator is the single writer of stream state.

**publisher** — the component that produces objects. It creates the
session, requests slots, uploads objects to storage under the granted keys,
posts commits, and maintains its lease through heartbeats.

**viewer** — a consumer of the stream. It fetches delivery documents
rendered from the committed window (in the CMAF/LL-HLS profile, playlists)
and objects from the delivery origin. Viewers never observe uncommitted
objects through the protocol.

**delivery URL** — the reference under which a committed object is
addressed in delivery documents. A delivery URL is either an absolute
HTTP(S) URL or a safe relative path. In both cases the URL contains no
query strings, fragments, control characters, `.` or `..` segments, or
empty path segments.

**object key** — the storage-relative name of an object. The reference
derivation (`olos/src/state/object-key-derivation.ts`) produces
`objects/<trackId>/s<seq>[-<nonce>][.<ext>]` for segments,
`objects/<trackId>/s<seq>/p<part>[-<nonce>][.<ext>]` for parts, and
`objects/<trackId>/init[-<nonce>][.<ext>]` for init objects, where
`<seq>` is the sequence number. The prefix and the extension are
configurable; Core attaches no extension by default and requires none.
A profile MAY require an extension (the CMAF/LL-HLS profile requires
`.mp4` for init objects and `.m4s` for segments and parts, Section 8).
Object keys MUST be safe relative keys. A safe relative key is non-empty
and has no leading or trailing slash and no empty, `.` or `..` segments. It
contains no query or fragment characters and no control characters. The
optional nonce makes keys unguessable in the direct-public profile
(Section 10).

**wire version** — the value of the `olos` field (`"1.0"`) carried by
sessions, cursors, and provider capability documents. Versioning policy is
defined in Section 11.
