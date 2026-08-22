# 8. CMAF/LL-HLS profile and playlist mapping

This section defines the **CMAF/LL-HLS profile** (`profile.id =
"cmaf-llhls"`). It maps a committed window (Section 5) and a session
document (Section 3) to Low-Latency HLS playlists, and it defines the
protocol for blocking playlist reload. The profile gives meaning to the
`profile` field on sessions, tracks, upload slots, commits, committed
objects, and track windows (Section 8.9). Core carries those values
unchanged (Section 2.1). Their JSON Schemas are Appendix A.2.

Reference implementation (informative): `olos/src/media/*.ts` (profile
data, validation, object keys, track-window hook, publisher pacing) and
`olos/src/hls/master-playlist.ts`, `media-playlist.ts`,
`manifest-artifacts.ts`, and `blocking-reload.ts` (rendering).

Rendering MUST reject a session or cursor whose `profile.id` is not
`cmaf-llhls`. Rendering MUST reject a session whose tracks do not carry
a valid track profile (Section 8.9.2).

The coordinator MUST serve playlists with content type
`application/vnd.apple.mpegurl` and the playlist cache policy of
Section 10.4. Rendering MUST be deterministic. The same session and
committed window MUST produce byte-identical playlists.

## 8.1 Media URIs

Every URI emitted into a playlist (init map, segment, part, preload
hint) MUST be a root-relative path or an absolute HTTPS URL. An
absolute URL's origin MUST be in the deployment's allow-list of media
origins (Section 10.2). If a URI violates this policy, rendering MUST
fail. Quoted attribute values MUST NOT contain double quotes, carriage
returns, or line feeds. RFC 8216 Section 4.2 quoted-strings have no
escape mechanism. If a value contains one of those characters,
rendering MUST fail. Media playlist URIs in the master playlist
(variant and `EXT-X-MEDIA` `URI`) MUST be root-relative paths without
query or fragment.

## 8.2 Master playlist

<!-- olos-conformance: 8.2 HLS-GOLDEN-001 HLS-GOLDEN-009 HLS-AVAIL-001 -->

The renderer builds the master playlist from the session document plus
the set of track ids present in the committed window. A track's HLS
role comes from its track profile `kind` (Section 8.9.2). A video or
grouped-audio track absent from the committed window (no segment or
part commits yet) MUST NOT render. The master only advertises URIs that
resolve, and the track appears on the next render after its first
commit. Ungrouped (muxed) audio tracks are codec metadata, and the
renderer never filters them. When no video track has committed objects,
the session has no master playlist yet and the master route answers 404
(Section 6.7).

The playlist MUST begin:

```
#EXTM3U
#EXT-X-VERSION:10
#EXT-X-INDEPENDENT-SEGMENTS
```

Any audio-group `EXT-X-MEDIA` lines (Section 8.3) follow. Then one
variant entry per video track follows, in session order:

```
#EXT-X-STREAM-INF:<attributes>
<media playlist URI>
```

Variant attribute rules (values are read from the video track's
profile, Section 8.9.2):

- `BANDWIDTH` and `AVERAGE-BANDWIDTH` are REQUIRED and both equal the
  track's `profile.bitrate`. A video track without `bitrate` is a
  rendering error.
- `CODECS` is REQUIRED. Its value is the video track's `profile.codec`
  followed by the session's audio codecs (Section 8.3.2),
  comma-separated and quoted.
- When the track declares dimensions, the renderer emits `RESOLUTION`
  (`<width>x<height>`). A track MUST declare `width` and `height`
  together or not at all.
- When the track declares `frameRate`, the renderer emits `FRAME-RATE`.
  The value has up to three decimals.
- When the session has an audio group, the renderer emits
  `AUDIO="<group-id>"` on every variant.

A master playlist requires at least one video track with committed
objects. A session without one has no master playlist (Section 6.7).
The renderer emits no content-steering or rendition-report tags.

## 8.3 Audio groups

<!-- olos-conformance: 8.3 HLS-AUDIO-001 HLS-AUDIO-002 -->

### 8.3.1 Grouping constraints

An audio track (track profile `kind: "audio"`) whose profile declares
`groupId` (a URL-safe identifier) joins the audio group. The
audio-group fields `groupId`, `name`, and `defaultTrack` are valid only
on audio tracks (Section 8.9.2). The rules:

- **One group.** All grouped audio tracks MUST share the same
  `groupId`. Multiple distinct audio group ids are a rendering error.
- **No mixing.** A session MUST NOT mix grouped and ungrouped audio
  tracks. If any audio track declares `groupId`, all of them MUST
  declare it.
- **One default.** At most one grouped audio track MAY carry
  `defaultTrack: true`. More than one is a validation error. That track
  is the group's default. When no track carries the flag, the first
  grouped audio track in declaration order is the default. The election
  runs over the session declaration and MUST NOT change with
  committed-window availability.

  While the elected default has no committed objects, every rendered
  member carries `DEFAULT=NO,AUTOSELECT=NO`. RFC 8216 makes
  `DEFAULT=YES` optional, so that output stays deterministic and
  spec-legal. Once the elected default has committed objects, it
  renders `DEFAULT=YES,AUTOSELECT=YES` permanently. When the real
  default appears, a re-elected stand-in default flips the player's
  selection back.
- **Distinct names.** The effective `NAME` of a grouped audio track is
  its `profile.name`, or its `trackId` when unset. Effective names MUST
  be distinct within the group. Duplicates are a validation and
  rendering error. Validation covers the full group, so any
  availability-filtered subset stays distinct. A `name` MUST NOT
  contain double quotes, carriage returns, or line feeds
  (Section 8.1).
- **Ungrouped audio.** When no audio track declares `groupId`, the
  renderer emits no `EXT-X-MEDIA` lines. It muxes every audio codec
  into every variant's `CODECS` attribute. Audio tracks get no
  standalone media playlists.

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
the distinct codecs of the rendered grouped audio tracks, deduplicated
in group order. Grouped audio tracks get standalone media playlists,
rendered from the committed window like video tracks. When no grouped
audio track has committed objects, the variants omit the `AUDIO`
attribute and `CODECS` carries only the video codec.

## 8.4 Media playlist

<!-- olos-conformance: 8.4 HLS-GOLDEN-002 HLS-GOLDEN-003 HLS-GOLDEN-004 HLS-GOLDEN-005 HLS-GOLDEN-006 HLS-GOLDEN-007 HLS-GOLDEN-008 HLS-GOLDEN-010 HLS-GOLDEN-011 -->

The renderer builds a media playlist per track from the committed
window. Rendering for an unknown track id is an error, and the HTTP
route answers 404. A session track absent from the committed window
produces no media playlist artifact, and its route answers 404. This
absence mirrors its exclusion from the master playlist (Section 8.2).
Only video tracks and grouped audio tracks get media playlists
(Section 8.3).

The timing targets come from the session profile (Section 8.9.1). When
the renderer works from coordinator state, it reads them from the
cursor's `profile`. The header block, in order:

| Tag | Normative value |
| --- | --- |
| `#EXTM3U` | Always first. |
| `#EXT-X-VERSION:10` | Fixed protocol version. |
| `#EXT-X-TARGETDURATION` | `ceil(profile.segmentTarget)` seconds. |
| `#EXT-X-PART-INF` | `PART-TARGET=<profile.partTarget>`, three-decimal seconds. |
| `#EXT-X-SERVER-CONTROL` | See Section 8.4.1. |
| `#EXT-X-MEDIA-SEQUENCE` | See Section 8.4.2. |
| `#EXT-X-DISCONTINUITY-SEQUENCE` | The track window's `profile.discontinuitySequence`, else the session profile's `discontinuitySequence`, else `0` (Section 8.4.2). |
| `#EXT-X-MAP` | `URI="<track init deliveryUrl>"`. Core allows a track window without `init` (Section 5). This profile REQUIRES one. If a track's window has no init object, rendering MUST fail. |

A blank line separates the header from the segment list. The renderer
never emits `EXT-X-PLAYLIST-TYPE`. An OLOS playlist is always a sliding
window that drops old segments. The `VOD` and `EVENT` playlist types
forbid that behavior, including after end of stream.

The renderer does not emit `EXT-X-GAP`. Gaps in the committed window
appear as absent entries. The renderer emits no rendition reports
(`EXT-X-RENDITION-REPORT`) and no content-steering tags.

### 8.4.1 SERVER-CONTROL and hold-back floor

<!-- olos-conformance: 8.4.1 HLS-HOLDBACK-001 -->

```
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=<p>,HOLD-BACK=<h>
```

- The server MUST advertise `CAN-BLOCK-RELOAD=YES` only when it
  implements blocking playlist reload (Section 8.7). A deployment that
  does not hold `_HLS_msn` or `_HLS_part` requests open MUST omit the
  attribute. RFC 8216bis Section 4.4.3.8 treats its absence as `NO`, so
  no `CAN-BLOCK-RELOAD=NO` form is ever rendered.
- `HOLD-BACK` is `max(3 × EXT-X-TARGETDURATION, targetLatency)`, where
  `targetLatency` is the deployment's target latency in seconds
  (Section 8.9.6). RFC 8216bis Section 4.4.3.8 floors the tag at three
  target durations. If `targetLatency` is below the floor, the renderer
  raises it to the floor. Apple's player rejects the entire playlist on
  an un-floored value (`HOLD-BACK less than 3 * target-duration`).
- `PART-HOLD-BACK` defaults to `max(3 × partTarget, targetLatency)`. A
  deployment MAY set it explicitly. The value MUST be at least
  `3 × partTarget`, the RFC 8216 LL-HLS floor. Lower values are a
  rendering error.
- The renderer formats both values as three-decimal seconds.

### 8.4.2 Per-track MEDIA-SEQUENCE

This profile aligns sequence numbers across tracks. The same sequence
number denotes the same time-aligned segment position in every track,
and maps directly to the HLS media-sequence number.
`#EXT-X-MEDIA-SEQUENCE` MUST equal the `sequenceNumber` of the rendered
track's own first segment. That number is the MSN of its first
`#EXTINF` or part entry. When the track has no segments, the value is
`committedWindow.firstSequenceNumber`.

When per-track trimming or empty-media segments delete leading
segments, tracks can diverge from the window-global minimum. A
global-minimum declaration there desynchronizes the declared sequence
from the first listed segment.

`#EXT-X-DISCONTINUITY-SEQUENCE` follows the same per-track rule. The
value is the track window's own `profile.discontinuitySequence` when
set (Section 8.9.4), else the session profile's `discontinuitySequence`
(Section 8.9.1), else `0`. When a track trims a leading segment whose
segment object carries `discontinuityBefore`, that track's
discontinuity sequence MUST count it (RFC 8216 Section 6.2.2). Other
tracks keep the session baseline.

### 8.4.3 Segment entries

Segments render in window order. The renderer reads per-segment values
from the object profile (Section 8.9.3) of the committed segment
object. When no segment object exists, it reads them from the profile
of part `0`. For each segment:

1. When the segment object's profile carries
   `discontinuityBefore: true`, the renderer emits
   `#EXT-X-DISCONTINUITY`. When the segment object's profile does not
   carry the flag, the renderer reads it from part 0's profile.
   Renderers MUST emit the tag whenever the committed window carries
   the marker.
2. When the segment object's profile carries `programDateTime`, the
   renderer emits `#EXT-X-PROGRAM-DATE-TIME:<timestamp>`. When it does
   not, the renderer reads `programDateTime` from part 0's profile.
   When neither profile carries one, the renderer emits no PDT tag.
3. Then either:
   - **Full segment** (a committed segment object exists):
     - When the segment carries committed parts (Section 8.5), one
       `#EXT-X-PART` line per part comes first. This rule applies while
       the segment is less than three target durations from the end of
       the playlist. Per RFC 8216bis Section 6.2.2, a server MUST keep
       a completed segment's parts until it is at least three target
       durations from the end.
     - No `#EXT-X-PRELOAD-HINT`. That hint only ever accompanies the
       in-progress parts-only segment.
     - Then `#EXTINF:<duration>,` (three-decimal seconds, trailing
       comma), followed by the segment's delivery URI on the next line.
     - The duration is the segment object's `profile.duration`. When
       the segment object carries none, the duration is the sum of its
       visible parts' `profile.duration`. A segment with neither value
       is a rendering error.
   - **Partial segment** (in-progress, parts only): one `#EXT-X-PART`
     line per committed part (Section 8.5), followed by at most one
     `#EXT-X-PRELOAD-HINT` (Section 8.5.1).

## 8.5 Parts and byterange addressing

<!-- olos-conformance: 8.5 HLS-BYTERANGE-001 HLS-BYTERANGE-002 HLS-BYTERANGE-003 -->

A part renders identically whether its segment is still in progress or
complete (Section 8.4.3).

Each committed part renders as:

```
#EXT-X-PART:DURATION=<d>[,INDEPENDENT=YES],URI="<uri>"[,BYTERANGE="<l>@<o>"]
```

- `DURATION` is the part's `profile.duration`, three-decimal seconds. A
  committed part without one is a rendering error.
- The renderer emits `INDEPENDENT=YES` when, and only when, the
  committed part carries `profile.independent: true` (the part starts
  with an independent frame).
- Per-part-URI sessions: `URI` is the part's own delivery URL. The
  renderer emits no `BYTERANGE` attribute.
- Byterange sessions: `URI` is the virtual segment's delivery URL
  (`byterange.segmentDeliveryUrl`), and `BYTERANGE="<length>@<offset>"`
  addresses the part within it. A byterange MUST have a non-negative
  integer `offset`, a positive integer `length`, a safe
  `segmentObjectKey`, and a safe `segmentDeliveryUrl`. Byteranges are
  valid only on parts.

### 8.5.1 PRELOAD-HINT

```
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="<uri>",BYTERANGE-START=<offset+length>
```

The renderer emits this hint only when the last committed part of the
in-progress (partial) segment uses byterange addressing. `URI` is the
virtual segment URL. `BYTERANGE-START` is that part's
`offset + length`, the offset of the next part. The renderer emits no
`BYTERANGE-LENGTH`, because the next part's size is unknown. The hinted
request is therefore open-ended, and Section 8.5.2 defines how the
service answers it.

Per-part-URI sessions emit no preload hints. A future per-part URL is a
deterministic guess, and its 404s can poison caches (Section 10.4).

### 8.5.2 Byterange aggregation service

A deployment that addresses parts by byterange MUST serve Range
requests over the aggregate. The aggregate is the committed parts whose
`byterange.segmentObjectKey` names the requested virtual segment,
concatenated in offset order. Aggregation is byte arithmetic over
`byterange.offset` and `byterange.length`. It reads no `profile` data.

| Request | Response |
| --- | --- |
| No range | `200`, no content-range and no content-length, full aggregate streamed. |
| Open-ended (start only) | `206`, `content-range: bytes <start>-9007199254740991/*`, no content-length, streamed live. |
| Bounded | `206`, `content-range: bytes <start>-<end>/*`, content-length, exactly the promised bytes. |
| Bounded, `end` at or above 9007199254740991 | served as open-ended. |
| Negative start, or end < start | `416`. |
| Unknown session, or no cursor | `404`. |

All success responses carry `accept-ranges: bytes`,
`cache-control: no-store`, and a caller-supplied `content-type`
(`video/mp4` under this profile).

Bounded responses use the RFC 9110 unknown-complete-length form,
because the virtual segment still grows.

Open-ended responses are `206`, because `200` claims a complete
representation from offset 0. RFC 8673 prescribes `206` with a very
large last-byte-pos for live open-ended ranges, and `9007199254740991`
is that value. Open-ended responses MUST NOT carry content-length. A
clean close marks the end.

When the viewer disconnects or cancels the body, the service MUST
release an in-flight part fetch and any pending cursor wait.

When a requested range extends past the committed bytes, the service
SHOULD hold the response open and stream new parts as they commit. A
wait timeout bounds the hold (default 3000 ms). This behavior is the
transport for `EXT-X-PRELOAD-HINT`.

If a part object returns no body or zero bytes for a requested range,
the service MUST error the response stream.

On a bounded range, a shortfall after the `206` MUST be a mid-stream
error, never a short but cleanly closed body.

## 8.6 End of stream

<!-- olos-conformance: 8.6 HLS-ENDLIST-001 -->

When the session (equivalently, the cursor's `state`) is terminal
(`ended` or `aborted`), every media playlist MUST end with
`#EXT-X-ENDLIST`. Players then stop polling. Live states MUST NOT emit
it. With `EXT-X-ENDLIST` present, `EXT-X-PLAYLIST-TYPE` stays omitted
(Section 8.4). The window can still slide as retention prunes.

## 8.7 Blocking playlist reload

<!-- olos-conformance: 8.7 HLS-BLOCK-001 HLS-BLOCK-002 HLS-BLOCK-003 -->

Media playlist requests MAY carry `_HLS_msn` and `_HLS_part` query
parameters (RFC 8216 LL-HLS blocking reload).

Routing and parsing:

These rules apply when the deployment enables blocking reload. A
deployment that does not hold requests open ignores the parameters
(Section 8.4.1).

- The request path MUST resolve to the master playlist or to one
  track's media playlist, with the same path resolution that rendering
  uses. A path that matches no artifact is `404` immediately. The
  server MUST NOT hold an unroutable request open.
- `_HLS_msn` or `_HLS_part` on the master playlist path is `400`.
  Delivery directives apply to media playlist requests (RFC 8216bis
  Section 6.2.5.1). The coordinator serves master requests without
  directives immediately and never holds them.
- Absent parameters mean "serve immediately".
- Present parameters MUST be non-negative integers. Anything else is
  `400`.
- `_HLS_part` without `_HLS_msn` is `400`.

Resolution uses the requested track's own live edge. `last` is the
`sequenceNumber` of that track's last visible segment in the cursor's
committed window. `lastPart` is that segment's last visible part
number, absent when the tail is a full segment. A lagging track
therefore blocks until its own playlist changes. Requests resolved
without a track context (no `trackId` attached) use the `cursor.window`
bounds instead (Section 5).

| Condition | Result |
| --- | --- |
| No `_HLS_msn` | ready |
| Track absent from the committed window | block (its route is `404` before any wait starts, Section 8.4) |
| `_HLS_msn > last + 2` | `400` (RFC 8216bis Section 6.2.5.2). Evaluated once, on the request's entry cursor. `_HLS_msn == last + 2` blocks. |
| `_HLS_msn > last` | block |
| `_HLS_msn < last` | ready (regardless of `_HLS_part`) |
| `_HLS_msn == last` and no `_HLS_part` | ready |
| `_HLS_msn == last` and `_HLS_part > lastPart` | block |
| `_HLS_msn == last` and `_HLS_part <= lastPart` | ready |

On a full-segment tail (`lastPart` absent), part requests at the last
MSN never block. The segment is already complete.

Blocking behavior:

- The coordinator MUST hold a blocked request open until a newer cursor
  satisfies the resolution or the configured timeout (default 3000 ms)
  elapses. It re-resolves each new cursor with the same table.
- When the cursor's session state is terminal (`ended` or `aborted`), a
  blocked request MUST resolve immediately. Nothing further commits, so
  the response is `200` with the final playlist, which carries
  `#EXT-X-ENDLIST` (Section 8.6).
- A successful commit that advances the cursor MUST wake waiting
  requests (Section 6.5.2). Rejected commits MUST NOT wake any request.
- A timeout is not an error. The response is `200` with the playlist
  rendered from the latest observed cursor. A non-blocking request
  receives the same response.
- A zero timeout degrades to non-blocking behavior.
- The wait deadline is a value in epoch milliseconds. Implementations
  MAY inject the clock that produces it. Deadline arithmetic MUST use
  the injected clock for the initial deadline and for remaining time.
- After a `ready` or `timeout` wait, the renderer MUST render the
  playlist from the cursor that the wait returns. End-of-stream
  detection (Section 8.6) MUST use that cursor's state.
- The coordinator renders only the requested artifact per request. A
  media playlist request renders that one track's playlist, and a
  master request renders the master playlist.

## 8.8 Examples (informative)

The examples below are informative illustrations of the rules above.
URLs and identifiers are placeholders.

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

`#EXT-X-MEDIA-SEQUENCE:3810` matches the first listed segment's MSN
(Section 8.4.2). No preload hint appears because the parts use per-part
URIs (Section 8.5.1).

## 8.9 Profile data

This subsection defines the `profile` values that the CMAF/LL-HLS
profile places on Core wire objects. Core validates each as a JSON
object and carries it unchanged (Section 2.1). The rules below apply on
top of Core validation. Every profile object is closed. Keys outside
those listed are a validation error. The JSON Schemas are Appendix A.2
(`mediaSessionProfile`, `mediaTrackProfile`, `mediaObjectProfile`,
`mediaSession`).

Reference implementation (informative): `olos/src/media/types.ts` and
`olos/src/media/validation.ts`.

### 8.9.1 Session profile

Core copies `session.profile` unchanged onto every cursor's `profile`
(Section 5). It carries the timing targets that every playlist,
hold-back, and publisher cadence derives from:

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | REQUIRED. MUST be `"cmaf-llhls"`. |
| `segmentTarget` | number | REQUIRED. Target segment duration in seconds, `> 0`. Source of `EXT-X-TARGETDURATION` (Section 8.4) and the `HOLD-BACK` floor (Section 8.4.1). |
| `partTarget` | number | REQUIRED. Target part duration in seconds, `> 0`. Source of `PART-TARGET` and the `PART-HOLD-BACK` floor (Section 8.4.1). |
| `discontinuitySequence` | integer | OPTIONAL. Baseline `EXT-X-DISCONTINUITY-SEQUENCE`, `>= 0`. Defaults to `0`. The track window profile records per-track offsets for trimmed discontinuities (Section 8.9.4). |

If `profile.id` is any other value, the session is not a CMAF/LL-HLS
session, and rendering MUST reject it.

### 8.9.2 Track profile

Every track of a CMAF/LL-HLS session MUST carry a `profile`. Core
allows tracks without one. A track without one is a validation and
rendering error under this profile. The track profile describes one
encoded variant of the session's media:

| Field | Type | Rule |
| --- | --- | --- |
| `kind` | string | REQUIRED. One of `audio`, `video`, `text`, `metadata`. Decides the track's HLS role: `video` tracks render as variants, `audio` tracks as muxed codecs or `EXT-X-MEDIA` renditions (Section 8.3). |
| `codec` | string | REQUIRED. Non-empty RFC 6381 codec string. Source of `CODECS` (Section 8.2). |
| `bitrate` | integer | OPTIONAL, `> 0`. REQUIRED for `video` tracks at render time (`BANDWIDTH`, Section 8.2). |
| `width`, `height` | integer | OPTIONAL, `> 0`. MUST be declared together or not at all (`RESOLUTION`). |
| `frameRate` | number | OPTIONAL, `> 0` (`FRAME-RATE`). |
| `channels` | integer | OPTIONAL, `> 0` (`CHANNELS` on `EXT-X-MEDIA`). |
| `sampleRate` | integer | OPTIONAL, `> 0`. Informational. Not rendered. |
| `groupId` | string | OPTIONAL, audio tracks only. URL-safe identifier (`[A-Za-z0-9._-]+`). The `EXT-X-MEDIA` `GROUP-ID`. |
| `name` | string | OPTIONAL, audio tracks only. Non-empty. The `EXT-X-MEDIA` `NAME`. MUST NOT contain double quotes, carriage returns, or line feeds. |
| `defaultTrack` | boolean | OPTIONAL, audio tracks only. Marks the audio group's default member. |

Tracks of kind `text` or `metadata` are accepted and carried in the
window. This revision does not render them.

`groupId`, `name`, and `defaultTrack` on a track whose `kind` is not
`audio` are a validation error. The audio-group constraints of
Section 8.3.1 also apply to sessions: one group, no mixing of grouped
and ungrouped audio, at most one `defaultTrack`, and distinct effective
names (`name`, else `trackId`) within the group. Validation applies
these constraints to the full session declaration, before availability
filtering.

### 8.9.3 Object profile

Upload slots, commits, and committed objects (segment objects and parts
alike) carry the object profile:

| Field | Type | Rule |
| --- | --- | --- |
| `duration` | number | Media duration in seconds, `> 0`. REQUIRED on `segment` and `part` objects. OPTIONAL on `init` objects. |
| `independent` | boolean | OPTIONAL. `true` when the object starts with an independent (key) frame. Rendered as `INDEPENDENT=YES` on parts (Section 8.5). |
| `programDateTime` | string | OPTIONAL. RFC 3339 date-time. Rendered as `EXT-X-PROGRAM-DATE-TIME` (Section 8.4.3). |
| `discontinuityBefore` | boolean | OPTIONAL. `true` when a discontinuity precedes this segment. Rendered as `EXT-X-DISCONTINUITY` (Section 8.4.3). Counted by the track window profile when the segment is trimmed (Section 8.9.4). |

The slot's `profile` is the issuer's expectation, for example the
planned `duration` (Section 8.9.6). On commit, Core merges the commit
profile over the slot profile as Section 4.5.1 defines. Under this
profile, the merged object profile of a `segment` or `part` object MUST
carry a positive `duration`. Coordinators SHOULD reject a `segment` or
`part` commit whose merged profile lacks one. A committed window that
reaches the renderer without one is a rendering error (Sections 8.4.3
and 8.5).

At render time a segment's values resolve as Section 8.4.3 defines.

### 8.9.4 Track window profile

The profile's `trackWindowProfile` hook produces a track window's
`profile` at window build time (Section 5.7). Under this profile it is:

| Field | Type | Rule |
| --- | --- | --- |
| `discontinuitySequence` | integer | The session baseline (`session.profile.discontinuitySequence`, else `0`) plus the number of segments trimmed from the front of this track's window that carry `discontinuityBefore: true`. The flag resolves as Section 8.4.3 defines. |

While the count of trimmed discontinuities is zero, the hook returns no
profile, and the track window carries no `profile` key. Unchanged
windows then keep their serialized shape. Section 8.4.2 defines how the
value renders.

### 8.9.5 Object keys

Core derives object keys with an OPTIONAL extension (Section 7.5). This
profile REQUIRES the extension. An init object's key MUST end in
`.mp4`. A segment or part object's key MUST end in `.m4s`. Keys with
any other extension are a validation error.

Reference implementation (informative): `olos/src/media/object-key.ts`.

### 8.9.6 Publisher pacing

The profile supplies the object-based defaults for low-latency pacing
that a publisher and coordinator share. Playlists, slot expiry, lease
heartbeats, and health reporting then assume one cadence. The defaults
are:

| Setting | Default | Role |
| --- | --- | --- |
| `partTarget` | 0.5 s | Part cadence. `PART-TARGET`. |
| `segmentTarget` | 2 s | Segment cadence. `EXT-X-TARGETDURATION`. |
| `targetLatency` | 3 s | End-to-end latency goal. Input to `HOLD-BACK`, `PART-HOLD-BACK`, and slot expiry. |
| `partHoldBack` | 3 s | `PART-HOLD-BACK` (Section 8.4.1). |
| `minUploadTtlSeconds` | 1 s | Floor for issued upload slot TTLs. |

Per object kind, the publisher's planned-object defaults set
`cadenceSeconds` and the slot `profile.duration` to the same value:
`partTarget` for parts, `segmentTarget` for segments, and an explicitly
supplied duration for init objects. Object keys use the default
extensions of Section 8.9.5 unless a deployment overrides them with
another supported extension. `cadenceSeconds` feeds slot expiry. An
upload slot's TTL is
`max(minUploadTtlSeconds, ceil(cadenceSeconds + targetLatency))`
seconds. A deployment MAY tune these values, but the rendering floors
of Section 8.4.1 still apply.

Reference implementation (informative): `olos/src/media/latency-profile.ts`.
