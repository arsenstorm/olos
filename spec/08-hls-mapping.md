# 8. CMAF/LL-HLS profile and playlist mapping

This section defines the **CMAF/LL-HLS profile** (`profile.id =
"cmaf-llhls"`) and how a committed window (Section 5) and a session
document (Section 3) render to Low-Latency HLS playlists, including
the blocking playlist reload protocol. The profile defines the
contents of the `profile` field on sessions, tracks, upload slots,
commits, committed objects, and track windows (Section 8.8). Core
treats those values as opaque JSON objects; only this profile gives
them meaning. Their JSON Schemas are Appendix A.2. The normative
reference is `olos/src/media/*.ts` (profile data, validation, object
keys, track-window hook, publisher pacing) and
`olos/src/hls/master-playlist.ts`, `media-playlist.ts`,
`manifest-artifacts.ts`, and `blocking-reload.ts` (rendering).

Rendering MUST reject a session or cursor whose `profile.id` is not
`cmaf-llhls`, and a session whose tracks do not carry a valid track
profile (Section 8.8.2).

Playlists MUST be served with content type
`application/vnd.apple.mpegurl` and the manifest cache policy of
Section 10.4. Rendering MUST be deterministic. The same session and
committed window MUST produce byte-identical playlists.

## 8.1 Media URIs

Every URI emitted into a playlist (init map, segment, part, preload
hint) MUST be a root-relative path or an absolute HTTPS URL. An
absolute URL's origin MUST be in the deployment's allow-list of media
origins (Section 10.2). Playlist rendering MUST fail rather than emit
a URI that violates this policy. Quoted attribute values MUST NOT
contain double quotes, carriage returns, or line feeds — RFC 8216
Section 4.2 quoted-strings have no escape mechanism — and rendering
MUST fail rather than emit such a value.

## 8.2 Master playlist

<!-- olos-conformance: 8.2 HLS-GOLDEN-001 HLS-GOLDEN-009 HLS-AVAIL-001 -->

The renderer builds the master playlist from the session document plus
the set of track ids present in the committed window. A track's HLS
role comes from its track profile `kind` (Section 8.8.2). A video or
grouped-audio track absent from the committed window (no segment or
part commits yet) MUST NOT render — the master only advertises URIs
that resolve, and the track appears on the next render after its
first commit. Ungrouped (muxed) audio tracks are codec metadata and
are never filtered. When no video track has committed objects, the
session has no master playlist yet and the master route answers 404
(Section 6.7). The playlist MUST begin:

```
#EXTM3U
#EXT-X-VERSION:10
#EXT-X-INDEPENDENT-SEGMENTS
```

The audio-group `EXT-X-MEDIA` lines (Section 8.3) follow, if any.
Then one variant entry per **video** track follows, in session order:

```
#EXT-X-STREAM-INF:<attributes>
<media playlist URI>
```

Variant attribute rules (values are read from the video track's
profile, Section 8.8.2):

- `BANDWIDTH` and `AVERAGE-BANDWIDTH` are REQUIRED and both equal the
  track's `profile.bitrate`. A video track without `bitrate` is a
  rendering error.
- `CODECS` is REQUIRED. Its value is the video track's `profile.codec`
  followed by the session's audio codecs (Section 8.3.2),
  comma-separated and quoted.
- The renderer emits `RESOLUTION` (`<width>x<height>`) when the
  track declares dimensions. `width` and `height` MUST be declared
  together or not at all.
- The renderer emits `FRAME-RATE` when the track declares
  `frameRate`. The value has up to three decimals.
- When the session has an audio group, the renderer emits
  `AUDIO="<group-id>"` on every variant.

A session MUST include at least one video track. Content-steering and
rendition-report tags are not emitted.

## 8.3 Audio groups

<!-- olos-conformance: 8.3 HLS-AUDIO-001 HLS-AUDIO-002 -->

### 8.3.1 Grouping constraints

An audio track (track profile `kind: "audio"`) joins the audio group
when its profile declares `groupId` (a URL-safe identifier). The
audio-group fields `groupId`, `name`, and `defaultTrack` are valid
only on audio tracks (Section 8.8.2). The rules:

- **One group.** All grouped audio tracks MUST share the same
  `groupId`. Multiple distinct audio group ids are a rendering error.
- **No mixing.** A session MUST NOT mix grouped and ungrouped audio
  tracks. If any audio track declares `groupId`, all of them MUST
  declare it.
- **One default.** At most one grouped audio track MAY carry
  `defaultTrack: true`; more than one is a validation error. The
  group's default is that track. When no track carries the flag, the
  first **declared** grouped audio track is the default. The election
  runs over the session declaration and MUST NOT change with
  committed-window availability: while the elected default has no
  committed objects, every rendered member carries
  `DEFAULT=NO,AUTOSELECT=NO` (deterministic and spec-legal — RFC 8216
  makes `DEFAULT=YES` optional); once the elected default has
  committed objects it renders `DEFAULT=YES,AUTOSELECT=YES`
  permanently. Re-electing a stand-in default would flip the player's
  selection back once the real default appears.
- **Distinct names.** The effective `NAME` of a grouped audio track
  is its `profile.name`, or its `trackId` when unset. Effective names
  MUST be distinct within the group; duplicates are a validation and
  rendering error. The full group is checked, so any
  availability-filtered subset stays distinct. A `name` MUST NOT
  contain double quotes, carriage returns, or line feeds
  (Section 8.1).
- **Legacy ungrouped audio.** When no audio track declares `groupId`,
  the renderer emits no `EXT-X-MEDIA` lines. It muxes every audio
  codec into every variant's `CODECS` attribute. Audio tracks get no
  standalone media playlists. This rule preserves pre-audio-group
  behavior.

### 8.3.2 EXT-X-MEDIA rendering

Each grouped audio track present in the committed window renders one
`EXT-X-MEDIA` rendition line, in session order:

```
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="<groupId>",NAME="<name>",\
DEFAULT=<YES|NO>,AUTOSELECT=<YES|NO>[,CHANNELS="<channels>"],URI="<uri>"
```

(one physical line, wrapped here for width). Attribute by attribute:

| Attribute | Value |
| --- | --- |
| `TYPE` | Always `AUDIO`. |
| `GROUP-ID` | The shared group id, quoted. |
| `NAME` | The track's `profile.name`, or its `trackId` when unset. |
| `DEFAULT` | `YES` for the session-elected default (Section 8.3.1), `NO` otherwise. While the elected default is not rendered, every member is `NO`. |
| `AUTOSELECT` | Matches `DEFAULT`. Tracks carry no `LANGUAGE`, `ASSOC-LANGUAGE`, `FORCED`, or `CHARACTERISTICS` attributes, so RFC 8216 Section 4.3.4.1.1 permits only one `AUTOSELECT=YES` member per group. |
| `CHANNELS` | Emitted only when the track declares `profile.channels`. |
| `URI` | The track's media playlist URI (Section 8.1). |

With an audio group, each variant's `CODECS` is the video codec plus
the **distinct** codecs of the rendered grouped audio tracks,
deduplicated in group order. Grouped audio tracks get standalone
media playlists, rendered from the committed window like video
tracks. When no grouped audio track has committed objects, the
variants omit the `AUDIO` attribute and `CODECS` carries only the
video codec.

## 8.4 Media playlist

<!-- olos-conformance: 8.4 HLS-GOLDEN-002 HLS-GOLDEN-003 HLS-GOLDEN-004 HLS-GOLDEN-005 HLS-GOLDEN-006 HLS-GOLDEN-007 HLS-GOLDEN-008 HLS-GOLDEN-010 HLS-GOLDEN-011 -->

The renderer builds a media playlist per track from the committed
window. Rendering for an unknown track id is an error (the HTTP route
answers 404). A session track absent from the committed window
produces no media playlist artifact and its route answers 404,
mirroring its exclusion from the master playlist (Section 8.2). Only
video tracks and grouped audio tracks get media playlists
(Section 8.3). The timing targets come from the session profile
(Section 8.8.1), read from the cursor's `profile` when rendering from
coordinator state. The header block, in order:

| Tag | Normative value |
| --- | --- |
| `#EXTM3U` | Always first. |
| `#EXT-X-VERSION:10` | Fixed protocol version. |
| `#EXT-X-TARGETDURATION` | `ceil(profile.segmentTarget)` seconds. |
| `#EXT-X-PART-INF` | `PART-TARGET=<profile.partTarget>`, three-decimal seconds. |
| `#EXT-X-SERVER-CONTROL` | See Section 8.4.1. |
| `#EXT-X-MEDIA-SEQUENCE` | See Section 8.4.2. |
| `#EXT-X-DISCONTINUITY-SEQUENCE` | The track window's `profile.discontinuitySequence`, else the session profile's `discontinuitySequence`, else `0` (Section 8.4.2). |
| `#EXT-X-MAP` | `URI="<track init deliveryUrl>"`. Core allows a track window without `init` (Section 5); this profile REQUIRES one, and rendering MUST fail for a track whose window has no init object. |

A blank line separates the header from the segment list. The renderer
never emits `EXT-X-PLAYLIST-TYPE`. An OLOS playlist is always a
sliding window, and old segments fall off. The `VOD` and `EVENT`
playlist types forbid this behavior, including after end of stream.
This revision does not emit `EXT-X-GAP`. Gaps in the committed window
appear as absent entries, never as GAP tags. Rendition reports
(`EXT-X-RENDITION-REPORT`) and content steering are not emitted.

### 8.4.1 SERVER-CONTROL and hold-back floor

<!-- olos-conformance: 8.4.1 HLS-HOLDBACK-001 -->

```
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=<p>,HOLD-BACK=<h>
```

- `CAN-BLOCK-RELOAD=YES` MUST only be advertised when the server
  implements blocking playlist reload (Section 8.6). A deployment
  that does not hold `_HLS_msn`/`_HLS_part` requests open MUST omit
  the attribute; RFC 8216bis Section 4.4.3.8 treats its absence as
  `NO`, so no `CAN-BLOCK-RELOAD=NO` form is ever rendered.
- `HOLD-BACK` is `max(3 × EXT-X-TARGETDURATION, targetLatency)`, where
  `targetLatency` is the deployment's target latency in seconds
  (default 3). RFC 8216bis Section 4.4.3.8 floors the tag at three
  target durations. Unlike `PART-HOLD-BACK`, a `targetLatency` below
  the floor is raised rather than rejected: it is a latency goal
  rather than the wire tag, and the floor moves with `segmentTarget`.
  Emitting an un-floored value makes Apple's player reject the entire
  playlist (`HOLD-BACK less than 3 * target-duration`), which
  MSE-based players such as hls.js do not enforce.
- `PART-HOLD-BACK` defaults to `max(3 × partTarget, targetLatency)`.
  A deployment MAY set it explicitly, but the value MUST be at least
  `3 × partTarget` (the RFC 8216 LL-HLS floor). Lower values are a
  rendering error, not a silent clamp.
- Both values are formatted as three-decimal seconds.

### 8.4.2 Per-track MEDIA-SEQUENCE

This profile maps a Core sequence number (Section 5) directly to an
HLS media sequence number. `#EXT-X-MEDIA-SEQUENCE` MUST equal the
`sequenceNumber` of the **rendered track's own first segment**. That
number is the MSN of its first `#EXTINF`/part entry. When the track
has no segments, the value falls back to
`committedWindow.firstSequenceNumber`. Tracks can diverge from the
window-global minimum when per-track trimming or empty-media segments
delete leading segments. A global-minimum declaration there
desynchronizes the declared sequence from the first listed segment.
(This per-track rule is the 0.6.0 behavior. Earlier revisions
declared the global window minimum.)

`#EXT-X-DISCONTINUITY-SEQUENCE` follows the same per-track rule: the
value is the track window's own `profile.discontinuitySequence` when
set (Section 8.8.4), else the session profile's
`discontinuitySequence` (Section 8.8.1), else `0`. When a track trims
a leading segment whose segment object is marked
`discontinuityBefore`, that track's discontinuity sequence MUST count
it (RFC 8216 Section 6.2.2) while other tracks keep the session
baseline.

### 8.4.3 Segment entries

Segments render in window order. Per-segment values are read from the
object profile (Section 8.8.3) of the committed segment object when
one exists, else from the profile of part `0`. For each segment:

1. `#EXT-X-DISCONTINUITY` when the segment object's profile carries
   `discontinuityBefore: true`, or, for a parts-only segment, when
   part 0's profile does. Renderers MUST emit the tag when the
   committed window carries the marker.
2. `#EXT-X-PROGRAM-DATE-TIME:<timestamp>` when the segment object's
   profile carries `programDateTime`, or, when it does not, when
   part 0's profile does. Segments without one emit no PDT tag.
3. Then either:
   - **Full segment** (a committed segment object exists): when the
     segment also carries committed parts (Section 8.5) and the
     segment is still less than three target durations from the end
     of the playlist, one `#EXT-X-PART` line per part first (RFC
     8216bis Section 6.2.2: a server MUST keep a completed segment's
     parts in the playlist until it is at least three target
     durations from the end), with no `#EXT-X-PRELOAD-HINT` — that
     hint only ever accompanies the in-progress parts-only segment.
     Then `#EXTINF:<duration>,` (three-decimal seconds, trailing
     comma) followed by the segment's delivery URI on the next line.
     The duration is the segment object's `profile.duration`, or,
     when the segment object carries none, the sum of its visible
     parts' `profile.duration`. A segment with neither is a rendering
     error.
   - **Partial segment** (in-progress, parts only): one `#EXT-X-PART`
     line per committed part (Section 8.5), followed by at most one
     `#EXT-X-PRELOAD-HINT` (Section 8.5.1).

## 8.5 Parts and byterange addressing

<!-- olos-conformance: 8.5 HLS-BYTERANGE-001 HLS-BYTERANGE-002 HLS-BYTERANGE-003 -->

A part renders identically whether its segment is still in progress
or has completed: a completed segment's parts remain in the playlist
until the segment is at least three target durations from the end
(Section 8.4.3).

Each committed part renders as:

```
#EXT-X-PART:DURATION=<d>[,INDEPENDENT=YES],URI="<uri>"[,BYTERANGE="<l>@<o>"]
```

- `DURATION` is the part's `profile.duration`, three-decimal seconds.
  A committed part without one is a rendering error.
- The renderer emits `INDEPENDENT=YES` when, and only when, the part
  was committed with `profile.independent: true` (starts with an
  independent frame).
- Per-part-URI sessions: `URI` is the part's own delivery URL. No
  `BYTERANGE` attribute is emitted.
- Byterange sessions: `URI` is the **virtual segment's** delivery URL
  (`byterange.segmentDeliveryUrl`) and
  `BYTERANGE="<length>@<offset>"` addresses the part within it. A
  byterange MUST have a non-negative integer `offset`, a positive
  integer `length`, a safe `segmentObjectKey`, and a safe
  `segmentDeliveryUrl`. Byteranges are valid only on parts.

### 8.5.1 PRELOAD-HINT

```
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="<uri>",BYTERANGE-START=<offset+length>
```

The renderer emits this hint only when the last committed part of the
in-progress (partial) segment uses byterange addressing. `URI` is the
virtual segment URL. `BYTERANGE-START` is that part's
`offset + length`, the byte at which the next part will land. No
`BYTERANGE-LENGTH` is emitted, because the next part's size is
unknown. The hinted request is therefore open-ended and is served as
Section 7.10 defines. Per-part-URI sessions emit no preload hints. A
future per-part URL is a deterministic guess, and its 404s can poison
caches (Section 10.4).

## 8.5.2 End of stream

<!-- olos-conformance: 8.5.2 HLS-ENDLIST-001 -->

When the session (equivalently, the cursor's `state`) is terminal
(`ended` or `aborted`), every media playlist MUST end with
`#EXT-X-ENDLIST`. Players then stop polling. Live states MUST NOT emit
it. Even with `EXT-X-ENDLIST` present, `EXT-X-PLAYLIST-TYPE` remains
omitted (Section 8.4). The window can still slide as retention prunes.

## 8.6 Blocking playlist reload

<!-- olos-conformance: 8.6 HLS-BLOCK-001 HLS-BLOCK-002 HLS-BLOCK-003 -->

Media playlist requests MAY carry `_HLS_msn` and `_HLS_part` query
parameters (RFC 8216 LL-HLS blocking reload).

Routing and parsing:

- The request path MUST resolve to the master playlist or one track's
  media playlist using the same path resolution rendering uses. A path matching no artifact is `404` **immediately** — the
  server MUST NOT hold an unroutable request open.
- `_HLS_msn` / `_HLS_part` on the **master** playlist path is `400`:
  delivery directives apply to media playlist requests (RFC 8216bis
  Section 6.2.5.1). Master requests without directives are served
  immediately, never held.
- Absent parameters mean "serve immediately".
- Present parameters MUST be non-negative integers. Anything else is
  `400`.
- `_HLS_part` without `_HLS_msn` is invalid (`400`).

Resolution is keyed to the **requested track's own live edge**:
`last` is the `sequenceNumber` of that track's last visible segment
in the cursor's committed window, and `lastPart` is that segment's
last visible part number (absent when the tail is a full segment). A
lagging track therefore blocks until *its own* playlist changes, not
until any track commits. Requests resolved without a track context
(the reference resolver's legacy window-global mode, when no
`trackId` is attached) use the `cursor.window` bounds instead
(Section 5).

| Condition | Result |
| --- | --- |
| No `_HLS_msn` | ready |
| Track absent from the committed window | block (its route is `404` before any wait starts, Section 8.4) |
| `_HLS_msn > last + 2` | `400` (RFC 8216bis Section 6.2.5.2). Evaluated once, on the request's entry cursor; `_HLS_msn == last + 2` blocks. |
| `_HLS_msn > last` | block |
| `_HLS_msn < last` | ready (regardless of `_HLS_part`) |
| `_HLS_msn == last` and no `_HLS_part` | ready |
| `_HLS_msn == last` and `_HLS_part > lastPart` | block |
| `_HLS_msn == last` and `_HLS_part <= lastPart` | ready |

On a full-segment tail (`lastPart` absent), part requests at the last
MSN never block. The segment is already complete.

Blocking behavior:

- The coordinator MUST hold a blocked request open until a newer
  cursor satisfies the resolution or the configured timeout elapses.
  It re-resolves each new cursor with the same table.
- When the cursor's session state is terminal (`ended` or `aborted`),
  a blocked request MUST resolve immediately: nothing further commits,
  so the response is `200` with the final playlist (which carries
  `#EXT-X-ENDLIST`, Section 8.5.2) instead of waiting out the timeout.
- A successful commit that advances the cursor MUST wake waiting
  requests (Section 6.5.2). Rejected commits MUST NOT wake any
  request.
- **Timeout is not an error.** The response is `200` with the playlist
  rendered from the latest observed cursor. A non-blocking request
  receives exactly the same response.
- A zero timeout degrades to non-blocking behavior.
- The wait deadline is computed from a monotonic-enough clock in epoch
  milliseconds. Implementations MAY inject this clock (the `now`
  option of the reference waiter). Deadline arithmetic MUST use the
  injected clock for both the initial deadline and remaining-time
  checks. Tests and embedders can then drive time deterministically.
- After a `ready` or `timeout` wait, the playlist MUST be rendered
  from the cursor returned by the wait (never a stale pre-wait
  snapshot). End-of-stream detection (Section 8.5.2) MUST use that
  cursor's state.
- Only the requested artifact is rendered per request: a media
  playlist request renders that one track's playlist, and a master
  request renders the master playlist. The server does not
  rebuild the session's full playlist set to answer one request.

## 8.7 Examples (informative)

The examples below are informative illustrations of the rules above,
not byte-golden requirements. URLs and identifiers are placeholders.

Master playlist with an audio group:

```
#EXTM3U
#EXT-X-VERSION:10
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="/v1/live/sess_01JZLIVE/a128/media.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="a64",DEFAULT=NO,AUTOSELECT=NO,URI="/v1/live/sess_01JZLIVE/a64/media.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,AVERAGE-BANDWIDTH=5000000,CODECS="avc1.640028,mp4a.40.2,ec-3",RESOLUTION=1920x1080,FRAME-RATE=30,AUDIO="aac"
/v1/live/sess_01JZLIVE/v1080/media.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,AVERAGE-BANDWIDTH=2800000,CODECS="avc1.4d401f,mp4a.40.2,ec-3",RESOLUTION=1280x720,FRAME-RATE=30,AUDIO="aac"
/v1/live/sess_01JZLIVE/v720/media.m3u8
```

Media playlist (two full segments, one in-progress segment with two
per-part-URI parts, and nonce-bearing object keys as in Section 7.5):

```
#EXTM3U
#EXT-X-VERSION:10
#EXT-X-TARGETDURATION:2
#EXT-X-PART-INF:PART-TARGET=0.500
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=3.000,HOLD-BACK=6.000
#EXT-X-MEDIA-SEQUENCE:3810
#EXT-X-DISCONTINUITY-SEQUENCE:0
#EXT-X-MAP:URI="https://media.example.com/objects/tenant_acme/sess_01JZLIVE/e1/v1080/init-slot_init_v1080.mp4"

#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:00.000Z
#EXTINF:2.000,
https://media.example.com/objects/tenant_acme/sess_01JZLIVE/e1/v1080/s3810-slot_s3810.m4s
#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:02.000Z
#EXTINF:2.000,
https://media.example.com/objects/tenant_acme/sess_01JZLIVE/e1/v1080/s3811-slot_s3811.m4s
#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:04.000Z
#EXT-X-PART:DURATION=0.500,INDEPENDENT=YES,URI="https://media.example.com/objects/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p0-slot_3812_0.m4s"
#EXT-X-PART:DURATION=0.500,URI="https://media.example.com/objects/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p1-slot_3812_1.m4s"
```

Note that `#EXT-X-MEDIA-SEQUENCE:3810` matches the first listed
segment's MSN (Section 8.4.2). No preload hint appears because the
parts use per-part URIs (Section 8.5.1).

## 8.8 Profile data

This subsection defines the `profile` values the CMAF/LL-HLS profile
places on Core wire objects. Core validates each as a JSON object
(plus a non-empty `id` on the session profile) and otherwise carries
it unchanged; the rules below apply on top of Core validation. Every
profile object is closed: keys outside those listed are a validation
error. The JSON Schemas are Appendix A.2 (`mediaSessionProfile`,
`mediaTrackProfile`, `mediaObjectProfile`, `mediaSession`). The
normative reference is `olos/src/media/types.ts` and
`olos/src/media/validation.ts`.

### 8.8.1 Session profile

`session.profile` (copied unchanged onto every cursor's `profile`,
Section 5) carries the timing targets every playlist, hold-back, and
publisher cadence derives from:

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | REQUIRED. MUST be `"cmaf-llhls"`. |
| `segmentTarget` | number | REQUIRED. Target segment duration in seconds, `> 0`. Source of `EXT-X-TARGETDURATION` (Section 8.4) and the `HOLD-BACK` floor (Section 8.4.1). |
| `partTarget` | number | REQUIRED. Target part duration in seconds, `> 0`. Source of `PART-TARGET` and the `PART-HOLD-BACK` floor (Section 8.4.1). |
| `discontinuitySequence` | integer | OPTIONAL. Baseline `EXT-X-DISCONTINUITY-SEQUENCE`, `>= 0`. Defaults to `0`. Per-track offsets for trimmed discontinuities are recorded by the track window profile (Section 8.8.4). |

A session or cursor whose `profile.id` is any other value is not a
CMAF/LL-HLS session; rendering MUST reject it.

### 8.8.2 Track profile

Every track of a CMAF/LL-HLS session MUST carry a `profile`. Core
allows tracks without one; a track missing it is a validation and
rendering error under this profile. The track profile describes one
encoded variant of the session's media:

| Field | Type | Rule |
| --- | --- | --- |
| `kind` | string | REQUIRED. One of `audio`, `video`, `text`, `metadata`. Decides the track's HLS role: `video` tracks render as variants, `audio` tracks as muxed codecs or `EXT-X-MEDIA` renditions (Section 8.3). |
| `codec` | string | REQUIRED. Non-empty RFC 6381 codec string; the source of `CODECS` (Section 8.2). |
| `bitrate` | integer | OPTIONAL, `> 0`. REQUIRED for `video` tracks at render time (`BANDWIDTH`, Section 8.2). |
| `width`, `height` | integer | OPTIONAL, `> 0`. MUST be declared together or not at all (`RESOLUTION`). |
| `frameRate` | number | OPTIONAL, `> 0` (`FRAME-RATE`). |
| `channels` | integer | OPTIONAL, `> 0` (`CHANNELS` on `EXT-X-MEDIA`). |
| `sampleRate` | integer | OPTIONAL, `> 0`. Informational; not rendered. |
| `groupId` | string | OPTIONAL, audio tracks only. URL-safe identifier (`[A-Za-z0-9._-]+`); the `EXT-X-MEDIA` `GROUP-ID`. |
| `name` | string | OPTIONAL, audio tracks only. Non-empty; the `EXT-X-MEDIA` `NAME`. MUST NOT contain double quotes, carriage returns, or line feeds. |
| `defaultTrack` | boolean | OPTIONAL, audio tracks only. Marks the audio group's default member. |

`groupId`, `name`, and `defaultTrack` on a track whose `kind` is not
`audio` are a validation error. Sessions are additionally subject to
the audio-group constraints of Section 8.3.1: one group, no mixing of
grouped and ungrouped audio, at most one `defaultTrack`, and distinct
effective names (`name`, else `trackId`) within the group. These
constraints are checked over the full session declaration, not over
the availability-filtered subset.

### 8.8.3 Object profile

Upload slots, commits, and committed objects (segment objects and
parts alike) carry the object profile:

| Field | Type | Rule |
| --- | --- | --- |
| `duration` | number | Media duration in seconds, `> 0`. REQUIRED on `segment` and `part` objects; OPTIONAL on `init` objects. |
| `independent` | boolean | OPTIONAL. `true` when the object starts with an independent (key) frame. Rendered as `INDEPENDENT=YES` on parts (Section 8.5). |
| `programDateTime` | string | OPTIONAL. RFC 3339 date-time; rendered as `EXT-X-PROGRAM-DATE-TIME` (Section 8.4.3). |
| `discontinuityBefore` | boolean | OPTIONAL. `true` when a discontinuity precedes this segment; rendered as `EXT-X-DISCONTINUITY` (Section 8.4.3) and counted by the track window profile when the segment is trimmed (Section 8.8.4). |

The slot's `profile` is the issuer's expectation (for example the
planned `duration`, Section 8.8.6). On commit, Core merges the
commit's `profile` over the slot's, key by key, with the commit
winning, and stores the result on the committed object. Under this
profile, the merged object profile of a `segment` or `part` object
MUST carry a positive `duration`. Coordinators SHOULD reject a
`segment` or `part` commit whose merged profile lacks one (the
reference validator is `assertMediaObjectProfile` with
`requireDuration`); a committed window that reaches the renderer
without one is a rendering error (Sections 8.4.3 and 8.5).

At render time a segment's values resolve as Section 8.4.3 defines:
the committed segment object's profile first, then part 0's profile
for `programDateTime` and `discontinuityBefore`, and the sum of the
visible parts' `duration` for `EXTINF` when the segment object
carries no `duration`.

### 8.8.4 Track window profile

A track window's `profile` is produced at window build time by the
profile's `trackWindowProfile` hook (Section 5) from the trimmed
segments. Under this profile it is:

| Field | Type | Rule |
| --- | --- | --- |
| `discontinuitySequence` | integer | The session baseline (`session.profile.discontinuitySequence`, else `0`) plus the number of segments trimmed from the front of this track's window flagged `discontinuityBefore: true` (on the segment object's profile, else part 0's — the same resolution as Section 8.4.3). |

The hook returns no profile (the track window carries no `profile`
key) while the count of trimmed discontinuities is zero, so unchanged
windows keep their serialized shape. Section 8.4.2 defines how the
value renders.

### 8.8.5 Object keys

Core derives object keys as `<prefix>/<trackId>/…` with an OPTIONAL
extension (Section 7); the default prefix is `objects`. This profile
REQUIRES the extension: an init object's key MUST end in `.mp4`, and
a segment or part object's key MUST end in `.m4s`. Keys with any
other extension are a validation error. With the default prefix the
layouts are:

- init: `objects/<trackId>/init[-nonce].mp4`
- segment: `objects/<trackId>/s<sequenceNumber>[-nonce].m4s`
- part: `objects/<trackId>/s<sequenceNumber>/p<partNumber>[-nonce].m4s`

The normative reference is `olos/src/media/object-key.ts`.

### 8.8.6 Publisher pacing

The profile supplies the object-based low-latency pacing defaults a
publisher and coordinator share so that playlists, slot expiry, lease
heartbeats, and health checks assume one cadence. The defaults are:

| Setting | Default | Role |
| --- | --- | --- |
| `partTarget` | 0.5 s | Part cadence; `PART-TARGET`. |
| `segmentTarget` | 2 s | Segment cadence; `EXT-X-TARGETDURATION`. |
| `targetLatency` | 3 s | End-to-end latency goal; input to `HOLD-BACK`, `PART-HOLD-BACK`, and slot expiry. |
| `partHoldBack` | 3 s | `PART-HOLD-BACK` (Section 8.4.1). |
| `publisherLeaseTtlMs` | 3000 ms | Publisher lease TTL requested per heartbeat (Section 6). |
| `cursorMaxAgeMs` | 5000 ms | Cursor age at which session health reports stale (`targetLatency + segmentTarget`). |
| `minUploadTtlSeconds` | 1 s | Floor for issued upload slot TTLs. |
| `blockingReloadTimeoutMs` | 3000 ms | Maximum hold time for a blocking playlist reload (Section 8.6). |
| `manifestMaxAgeSeconds` | 1 s | Playlist response `max-age` (Section 10.4). |

Per object kind, the publisher's planned-object defaults set
`cadenceSeconds` and the slot `profile.duration` to the same value:
`partTarget` for parts, `segmentTarget` for segments, and an
explicitly supplied duration for init objects. Object keys use the
default extensions of Section 8.8.5 unless overridden with another
supported extension. `cadenceSeconds` feeds slot expiry: an upload
slot's TTL is `max(minUploadTtlSeconds, ceil(cadenceSeconds +
targetLatency))` seconds. A deployment MAY tune these values, but the
rendering floors of Section 8.4.1 still apply. The normative
reference is `olos/src/media/latency-profile.ts` and
`latency-profile-defaults.ts`.
