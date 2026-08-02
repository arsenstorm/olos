# 01 Conventions and terminology

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
  `commitId`, `renditionId`, `groupId`, `providerId`, and event
  identifiers) is a non-empty string restricted to the URL-safe alphabet
  `A-Z a-z 0-9 . _ -`.
- **Durations** are positive JSON numbers in seconds. If a field name
  carries an explicit `Ms` (milliseconds) suffix, the value is in
  milliseconds.
- **Byte sizes** (`size`, `minBytes`, `maxBytes`, byterange `offset` and
  `length`) are JSON integers. Fractional byte counts are invalid.
- **Unknown fields.** Wire objects are closed. A receiver MUST reject a
  payload that carries a property not defined for that object.

## 1.3 Terminology

This specification uses the terms below with exactly these meanings. The
definitions derive from the reference implementation's public types
(`olos/src/types/`).

**session** — the unit of one live stream. A session is a wire object
identified by `sessionId`. It declares the wire version, an epoch, a
latency profile, segment and part duration targets, a set of renditions,
and a lifecycle state (`live`, `ending`, `ended`, or `aborted`). All slots,
commits, cursors, and manifests are scoped to a session.

**epoch** — a non-negative integer generation counter carried by a session
and inherited by every upload slot, commit, committed window, and cursor
derived from it. Positions in different epochs are ordered by epoch first.
Any position in a later epoch supersedes every position in an earlier one.

**rendition** — one encoded variant of the session's media, identified by
`renditionId` within the session. A rendition carries a kind (`audio`,
`video`, `text`, or `metadata`), a codec string, and optional
characteristics such as bitrate, dimensions, frame rate, or audio-group
membership. Each rendition has its own timeline of segments inside the
committed window.

**media sequence number (MSN)** — the non-negative integer index of a
segment position on a rendition timeline. MSNs increase monotonically. The
same MSN denotes the same time-aligned segment position across renditions.

**part** — a sub-segment media object addressed by an MSN plus a
non-negative `partNumber` within that segment. Parts make low-latency
delivery possible before the full segment exists. Parts are numbered from 0
and MAY be expressed as byte ranges into a virtual segment object.

**upload slot** — a single-use, coordinator-issued reservation for exactly
one media object. It fixes the object key, delivery URL, content type,
kind (`init`, `part`, or `segment`), position (MSN and optional part
number), duration, byte-size bounds, and an expiry deadline. A slot moves
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
state. It binds a `commitId` to the slot's position, object key, delivery
URL, duration, and the observed size and etag. Only an accepted commit
changes what viewers can see.

**cursor** — the coordinator's authoritative description of the live edge
of a session. The cursor advances monotonically. It carries the wire
version, session state, epoch, targets, the media base URL, and the
current committed window. It also carries the window's first and last MSN
plus the last visible part number.

**committed window** — the retained, viewer-visible span of committed
media. The window carries per-rendition init objects and ordered segment
lists bounded by a first and last MSN, together with an epoch and a
discontinuity sequence.
Only content in the committed window is rendered into manifests
(Section 05).

**media origin** — the HTTP origin (or origins) from which committed media
objects are served to viewers, rooted at the session's media base URL. In
the direct-public profile the media origin is the object store's public
endpoint or a CDN in front of it.

**coordinator** — the component that owns session state. It issues slots,
matches observed uploads against their slots, accepts or rejects commits,
advances the cursor, maintains publisher leases, and plans retention. The
coordinator is the single writer of stream state.

**publisher** — the component that produces media. It creates the session,
requests slots, uploads objects to storage under the granted keys, posts
commits, and maintains its lease through heartbeats.

**viewer** — a consumer of the stream. It fetches manifests derived from
the committed window and media objects from the media origin. Viewers
never observe uncommitted objects through the protocol.

**delivery URL** — the reference under which a committed object is
addressed in manifests. A delivery URL is either an absolute HTTP(S) URL
or a safe relative path. In both cases the URL contains no query strings,
fragments, control characters, `.` or `..` segments, or empty path
segments.

**object key** — the storage-relative name of a media object, for example
`media/<renditionId>/s<msn>[-<nonce>].m4s` for segments,
`media/<renditionId>/s<msn>/p<part>[-<nonce>].m4s` for parts, and
`media/<renditionId>/init[-<nonce>].mp4` for init objects. Object keys
MUST be safe relative keys. A safe relative key is non-empty and has no
leading or trailing slash and no empty, `.` or `..` segments. It contains
no query or fragment characters and no control characters. The optional
nonce makes keys unguessable in the direct-public profile (Section 10).

**wire version** — the value of the `olos` field (`"1.0"`) carried by
sessions, cursors, and provider capability documents. Versioning policy is
defined in Section 11.
