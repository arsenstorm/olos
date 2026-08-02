# 8. LL-HLS mapping

This section defines how a committed window (Section 5) and a session
document (Section 3) render to Low-Latency HLS playlists, and the
blocking playlist reload protocol. The normative reference is
`olos/src/hls/master-playlist.ts`, `media-playlist.ts`,
`manifest-artifacts.ts`, and `blocking-reload.ts`.

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
the set of rendition ids present in the committed window. A video or
grouped-audio rendition absent from the committed window (no media
commits yet) MUST NOT render — the master only advertises URIs that
resolve, and the rendition appears on the next render after its first
commit. Ungrouped (muxed) audio renditions are codec metadata and are
never filtered. When no video rendition has committed media, the
session has no master playlist yet and the master route answers 404
(Section 6.7). The playlist MUST begin:

```
#EXTM3U
#EXT-X-VERSION:10
#EXT-X-INDEPENDENT-SEGMENTS
```

The audio-group `EXT-X-MEDIA` lines (Section 8.3) follow, if any.
Then one variant entry per **video** rendition follows, in session
order:

```
#EXT-X-STREAM-INF:<attributes>
<media playlist URI>
```

Variant attribute rules:

- `BANDWIDTH` and `AVERAGE-BANDWIDTH` are REQUIRED and both equal the
  rendition's `bitrate`. A video rendition without `bitrate` is a
  rendering error.
- `CODECS` is REQUIRED. Its value is the video rendition's `codec`
  followed by the session's audio codecs (Section 8.3.2),
  comma-separated and quoted.
- The renderer emits `RESOLUTION` (`<width>x<height>`) when the
  rendition declares dimensions. `width` and `height` MUST be declared
  together or not at all.
- The renderer emits `FRAME-RATE` when the rendition declares
  `frameRate`. The value has up to three decimals.
- When the session has an audio group, the renderer emits
  `AUDIO="<group-id>"` on every variant.

A session MUST include at least one video rendition. Content-steering
and rendition-report tags are not emitted.

## 8.3 Audio groups

<!-- olos-conformance: 8.3 HLS-AUDIO-001 HLS-AUDIO-002 -->

### 8.3.1 Grouping constraints

An audio rendition joins the audio group when it declares `groupId`
(a URL-safe identifier). The rules:

- **One group.** All grouped audio renditions MUST share the same
  `groupId`. Multiple distinct audio group ids are a rendering error.
- **No mixing.** A session MUST NOT mix grouped and ungrouped audio
  renditions. If any audio rendition declares `groupId`, all of them
  MUST declare it.
- **One default.** The group's default is the first audio rendition
  with `defaultRendition: true`. When no rendition carries the flag,
  the first **declared** grouped audio rendition is the default. The
  election runs over the session declaration and MUST NOT change with
  committed-window availability: while the elected default has no
  committed media, every rendered member carries
  `DEFAULT=NO,AUTOSELECT=NO` (deterministic and spec-legal — RFC 8216
  makes `DEFAULT=YES` optional); once the elected default has
  committed media it renders `DEFAULT=YES,AUTOSELECT=YES`
  permanently. Re-electing a stand-in default would flip the player's
  selection back once the real default appears.
- **Distinct names.** The effective `NAME` of a grouped audio
  rendition is its `name`, or its `renditionId` when unset. Effective
  names MUST be distinct within the group; duplicates are a
  validation and rendering error. The full group is checked, so any
  availability-filtered subset stays distinct.
- **Legacy ungrouped audio.** When no audio rendition declares
  `groupId`, the renderer emits no `EXT-X-MEDIA` lines. It muxes every
  audio codec into every variant's `CODECS` attribute. Audio
  renditions get no standalone media playlists. This rule preserves
  pre-audio-group behavior.

### 8.3.2 EXT-X-MEDIA rendering

Each grouped audio rendition present in the committed window renders
one line, in session order:

```
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="<groupId>",NAME="<name>",\
DEFAULT=<YES|NO>,AUTOSELECT=<YES|NO>[,CHANNELS="<channels>"],URI="<uri>"
```

(one physical line, wrapped here for width). Attribute by attribute:

| Attribute | Value |
| --- | --- |
| `TYPE` | Always `AUDIO`. |
| `GROUP-ID` | The shared group id, quoted. |
| `NAME` | The rendition's `name`, or its `renditionId` when unset. |
| `DEFAULT` | `YES` for the session-elected default (Section 8.3.1), `NO` otherwise. While the elected default is not rendered, every member is `NO`. |
| `AUTOSELECT` | Matches `DEFAULT`. Renditions carry no `LANGUAGE`, `ASSOC-LANGUAGE`, `FORCED`, or `CHARACTERISTICS` attributes, so RFC 8216 Section 4.3.4.1.1 permits only one `AUTOSELECT=YES` member per group. |
| `CHANNELS` | Emitted only when the rendition declares `channels`. |
| `URI` | The rendition's media playlist URI (Section 8.1). |

With an audio group, each variant's `CODECS` is the video codec plus
the **distinct** codecs of the rendered grouped audio renditions,
deduplicated in group order. Grouped audio renditions get standalone
media playlists, rendered from the committed window like video
renditions. When no grouped audio rendition has committed media, the
variants omit the `AUDIO` attribute and `CODECS` carries only the
video codec.

## 8.4 Media playlist

<!-- olos-conformance: 8.4 HLS-GOLDEN-002 HLS-GOLDEN-003 HLS-GOLDEN-004 HLS-GOLDEN-005 HLS-GOLDEN-006 HLS-GOLDEN-007 HLS-GOLDEN-008 HLS-GOLDEN-010 HLS-GOLDEN-011 -->

The renderer builds a media playlist per rendition from the committed
window. Rendering for an unknown rendition id is an error (the HTTP
route answers 404). A session rendition absent from the committed
window produces no media playlist artifact and its route answers 404,
mirroring its exclusion from the master playlist (Section 8.2). The
header block, in order:

| Tag | Normative value |
| --- | --- |
| `#EXTM3U` | Always first. |
| `#EXT-X-VERSION:10` | Fixed protocol version. |
| `#EXT-X-TARGETDURATION` | `ceil(session.segmentTarget)` seconds. |
| `#EXT-X-PART-INF` | `PART-TARGET=<session.partTarget>`, three-decimal seconds. |
| `#EXT-X-SERVER-CONTROL` | See Section 8.4.1. |
| `#EXT-X-MEDIA-SEQUENCE` | See Section 8.4.2. |
| `#EXT-X-DISCONTINUITY-SEQUENCE` | The rendition window's `discontinuitySequence`, or `committedWindow.discontinuitySequence` when unset (Section 8.4.2). |
| `#EXT-X-MAP` | `URI="<rendition init deliveryUrl>"`. |

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

- The playlist always advertises `CAN-BLOCK-RELOAD=YES`. The server
  MUST implement Section 8.6.
- `HOLD-BACK` is the deployment's target latency in seconds
  (default 3).
- `PART-HOLD-BACK` defaults to `max(3 × partTarget, targetLatency)`.
  A deployment MAY set it explicitly, but the value MUST be at least
  `3 × partTarget` (the RFC 8216 LL-HLS floor). Lower values are a
  rendering error, not a silent clamp.
- Both values are formatted as three-decimal seconds.

### 8.4.2 Per-rendition MEDIA-SEQUENCE

`#EXT-X-MEDIA-SEQUENCE` MUST equal the media sequence number of the
**rendered rendition's own first segment**. That number is the MSN of
its first `#EXTINF`/part entry. When the rendition has no segments,
the value falls back to `committedWindow.firstMediaSequenceNumber`.
Renditions can diverge from the window-global minimum when
per-rendition trimming or empty-media segments delete leading
segments. A global-minimum declaration there desynchronizes the
declared sequence from the first listed segment. (This per-rendition
rule is the 0.6.0 behavior. Earlier revisions declared the global
window minimum.)

`#EXT-X-DISCONTINUITY-SEQUENCE` follows the same per-rendition rule:
the value is the rendition window's own `discontinuitySequence` when
set, falling back to `committedWindow.discontinuitySequence`. When a
rendition trims a leading segment marked `discontinuityBefore`, that
rendition's discontinuity sequence MUST count it (RFC 8216
Section 6.2.2) while other renditions keep the window-global value.

### 8.4.3 Segment entries

Segments render in window order. For each segment:

1. `#EXT-X-DISCONTINUITY` when the segment is marked
   `discontinuityBefore` (epoch changes, Section 5).
2. `#EXT-X-PROGRAM-DATE-TIME:<timestamp>` when the segment carries a
   `programDateTime`. Segments without one emit no PDT tag.
3. Then either:
   - **Full segment** (a committed segment object exists):
     `#EXTINF:<duration>,` (three-decimal seconds, trailing comma)
     followed by the segment's delivery URI on the next line, or
   - **Partial segment** (in-progress, parts only): one `#EXT-X-PART`
     line per committed part (Section 8.5), followed by at most one
     `#EXT-X-PRELOAD-HINT` (Section 8.5.1).

## 8.5 Parts and byterange addressing

<!-- olos-conformance: 8.5 HLS-BYTERANGE-001 HLS-BYTERANGE-002 HLS-BYTERANGE-003 -->

Each committed part renders as:

```
#EXT-X-PART:DURATION=<d>[,INDEPENDENT=YES],URI="<uri>"[,BYTERANGE="<l>@<o>"]
```

- `DURATION` is the part duration, three-decimal seconds.
- The renderer emits `INDEPENDENT=YES` when, and only when, the part
  was committed `independent` (starts with an independent frame).
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

- The request path MUST resolve to the master playlist or one
  rendition's media playlist using the same path resolution rendering
  uses. A path matching no artifact is `404` **immediately** — the
  server MUST NOT hold an unroutable request open.
- `_HLS_msn` / `_HLS_part` on the **master** playlist path is `400`:
  delivery directives apply to media playlist requests (RFC 8216bis
  Section 6.2.5.1). Master requests without directives are served
  immediately, never held.
- Absent parameters mean "serve immediately".
- Present parameters MUST be non-negative integers. Anything else is
  `400`.
- `_HLS_part` without `_HLS_msn` is invalid (`400`).

Resolution is keyed to the **requested rendition's own live edge**:
`last` is the media sequence number of that rendition's last visible
segment in the cursor's committed window, and `lastPart` is that
segment's last visible part number (absent when the tail is a full
segment). A lagging rendition therefore blocks until *its own*
playlist changes, not until any rendition commits. Requests resolved
without a rendition context (the reference resolver's legacy
window-global mode, when no `renditionId` is attached) use the
`cursor.window` bounds instead (Section 5).

| Condition | Result |
| --- | --- |
| No `_HLS_msn` | ready |
| Rendition absent from the committed window | block (its route is `404` before any wait starts, Section 8.4) |
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
  playlist request renders that one rendition's playlist, and a
  master request renders the master playlist. The server does not
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
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=3.000,HOLD-BACK=3.000
#EXT-X-MEDIA-SEQUENCE:3810
#EXT-X-DISCONTINUITY-SEQUENCE:0
#EXT-X-MAP:URI="https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/init-slot_init_v1080.mp4"

#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:00.000Z
#EXTINF:2.000,
https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3810-slot_s3810.m4s
#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:02.000Z
#EXTINF:2.000,
https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3811-slot_s3811.m4s
#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:04.000Z
#EXT-X-PART:DURATION=0.500,INDEPENDENT=YES,URI="https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p0-slot_3812_0.m4s"
#EXT-X-PART:DURATION=0.500,URI="https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p1-slot_3812_1.m4s"
```

Note that `#EXT-X-MEDIA-SEQUENCE:3810` matches the first listed
segment's MSN (Section 8.4.2). No preload hint appears because the
parts use per-part URIs (Section 8.5.1).
