# 8. LL-HLS mapping

This section defines how a committed window (Section 5) and a session
document (Section 3) render to Low-Latency HLS playlists, and the
blocking playlist reload protocol. The normative reference is
`olos/src/hls/master-playlist.ts`, `media-playlist.ts`,
`manifest-artifacts.ts`, and `blocking-reload.ts`.

Playlists MUST be served with content type
`application/vnd.apple.mpegurl` and the manifest cache policy of
Section 10.4. Rendering MUST be deterministic: the same session and
committed window MUST produce byte-identical playlists.

## 8.1 Media URIs

Every URI emitted into a playlist (init map, segment, part, preload
hint) MUST be either a root-relative path or an absolute HTTPS URL
whose origin is in the deployment's allow-list of media origins
(Section 10.2). Playlist rendering MUST fail rather than emit a URI
that violates this policy. Attribute values are escaped per the
playlist quoting rules of RFC 8216.

## 8.2 Master playlist

<!-- olos-conformance: 8.2 HLS-GOLDEN-001 HLS-GOLDEN-009 -->

The master playlist is rendered from the session document alone. It
MUST begin:

```
#EXTM3U
#EXT-X-VERSION:10
#EXT-X-INDEPENDENT-SEGMENTS
```

followed by the audio-group `EXT-X-MEDIA` lines (Section 8.3), if any,
then one variant entry per **video** rendition, in session order:

```
#EXT-X-STREAM-INF:<attributes>
<media playlist URI>
```

Variant attribute rules:

- `BANDWIDTH` and `AVERAGE-BANDWIDTH` are REQUIRED and both equal the
  rendition's `bitrate`; a video rendition without `bitrate` is a
  rendering error.
- `CODECS` is REQUIRED: the video rendition's `codec` followed by the
  session's audio codecs (Section 8.3.2), comma-separated, quoted.
- `RESOLUTION` (`<width>x<height>`) is emitted when the rendition
  declares dimensions; `width` and `height` MUST be declared together
  or not at all.
- `FRAME-RATE` is emitted when the rendition declares `frameRate`,
  formatted with up to three decimals.
- `AUDIO="<group-id>"` is emitted on every variant when the session
  has an audio group.

A session MUST include at least one video rendition. Content-steering
and rendition-report tags are not emitted.

## 8.3 Audio groups

<!-- olos-conformance: 8.3 HLS-AUDIO-001 HLS-AUDIO-002 -->

### 8.3.1 Grouping constraints

An audio rendition joins the audio group by declaring `groupId`
(a URL-safe identifier). The rules:

- **One group.** All grouped audio renditions MUST share the same
  `groupId`; multiple distinct audio group ids are a rendering error.
- **No mixing.** A session MUST NOT mix grouped and ungrouped audio
  renditions: once any audio rendition declares `groupId`, all of them
  MUST.
- **One default.** The group's default is the first audio rendition
  with `defaultRendition: true`; when none is flagged, the first
  grouped audio rendition is the default.
- **Legacy ungrouped audio.** When no audio rendition declares
  `groupId`, no `EXT-X-MEDIA` lines are emitted, every audio codec is
  muxed into every variant's `CODECS` attribute, and audio renditions
  get no standalone media playlists. This preserves pre-audio-group
  behavior.

### 8.3.2 EXT-X-MEDIA rendering

Each grouped audio rendition renders one line, in session order:

```
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="<groupId>",NAME="<name>",\
DEFAULT=<YES|NO>,AUTOSELECT=YES[,CHANNELS="<channels>"],URI="<uri>"
```

(one physical line; wrapped here for width). Attribute by attribute:

| Attribute | Value |
| --- | --- |
| `TYPE` | Always `AUDIO`. |
| `GROUP-ID` | The shared group id, quoted. |
| `NAME` | The rendition's `name`, or its `renditionId` when unset. |
| `DEFAULT` | `YES` for the group default, `NO` otherwise. |
| `AUTOSELECT` | Always `YES`. |
| `CHANNELS` | Emitted only when the rendition declares `channels`. |
| `URI` | The rendition's media playlist URI (Section 8.1). |

With an audio group, each variant's `CODECS` is the video codec plus
the **distinct** codecs of the grouped audio renditions, deduplicated
in group order. Grouped audio renditions DO get standalone media
playlists rendered from the committed window like video renditions.

## 8.4 Media playlist

<!-- olos-conformance: 8.4 HLS-GOLDEN-002 HLS-GOLDEN-003 HLS-GOLDEN-004 HLS-GOLDEN-005 HLS-GOLDEN-006 HLS-GOLDEN-007 HLS-GOLDEN-008 HLS-GOLDEN-010 HLS-GOLDEN-011 -->

A media playlist is rendered per rendition from the committed window.
Rendering for an unknown rendition id is an error (the HTTP route
answers 404). The header block, in order:

| Tag | Normative value |
| --- | --- |
| `#EXTM3U` | Always first. |
| `#EXT-X-VERSION:10` | Fixed protocol version. |
| `#EXT-X-TARGETDURATION` | `ceil(session.segmentTarget)` seconds. |
| `#EXT-X-PART-INF` | `PART-TARGET=<session.partTarget>`, three-decimal seconds. |
| `#EXT-X-SERVER-CONTROL` | See Section 8.4.1. |
| `#EXT-X-MEDIA-SEQUENCE` | See Section 8.4.2. |
| `#EXT-X-DISCONTINUITY-SEQUENCE` | `committedWindow.discontinuitySequence`. |
| `#EXT-X-MAP` | `URI="<rendition init deliveryUrl>"`. |

A blank line separates the header from the segment list.
`EXT-X-PLAYLIST-TYPE` is deliberately never emitted: an OLOS playlist
is always a sliding window — old segments fall off — which the `VOD`
and `EVENT` playlist types forbid, including after end of stream.
`EXT-X-GAP` is not emitted by this revision: gaps in the committed
window are represented by the absence of entries, never by GAP tags.
Rendition reports (`EXT-X-RENDITION-REPORT`) and content steering are
not emitted.

### 8.4.1 SERVER-CONTROL and hold-back floor

<!-- olos-conformance: 8.4.1 HLS-HOLDBACK-001 -->

```
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=<p>,HOLD-BACK=<h>
```

- `CAN-BLOCK-RELOAD=YES` is always advertised; the server MUST
  implement Section 8.6.
- `HOLD-BACK` is the deployment's target latency in seconds
  (default 3).
- `PART-HOLD-BACK` defaults to `max(3 × partTarget, targetLatency)`.
  A deployment MAY set it explicitly, but the value MUST be at least
  `3 × partTarget` (the RFC 8216 LL-HLS floor); lower values are a
  rendering error, not a silent clamp.
- Both are formatted as three-decimal seconds.

### 8.4.2 Per-rendition MEDIA-SEQUENCE

`#EXT-X-MEDIA-SEQUENCE` MUST equal the media sequence number of the
**rendered rendition's own first segment** — the MSN of its first
`#EXTINF`/part entry — falling back to
`committedWindow.firstMediaSequenceNumber` only when the rendition has
no segments. Renditions can diverge from the window-global minimum
when per-rendition trimming or empty-media segments drop leading
segments; declaring the global minimum there would desynchronize the
declared sequence from the first listed segment. (This per-rendition
rule is the 0.6.0 behavior; earlier revisions declared the global
window minimum.)

### 8.4.3 Segment entries

Segments render in window order. For each segment:

1. `#EXT-X-DISCONTINUITY` when the segment is marked
   `discontinuityBefore` (epoch changes, Section 5).
2. `#EXT-X-PROGRAM-DATE-TIME:<timestamp>` when the segment carries a
   `programDateTime`; segments without one emit no PDT tag.
3. Then either:
   - **Full segment** (a committed segment object exists):
     `#EXTINF:<duration>,` (three-decimal seconds, trailing comma)
     followed by the segment's delivery URI on the next line; or
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
- `INDEPENDENT=YES` is emitted iff the part was committed
  `independent` (starts with an independent frame).
- Per-part-URI sessions: `URI` is the part's own delivery URL and no
  `BYTERANGE` attribute is emitted.
- Byterange sessions: `URI` is the **virtual segment's** delivery URL
  (`byterange.segmentDeliveryUrl`) and
  `BYTERANGE="<length>@<offset>"` addresses the part within it. A
  byterange MUST have a non-negative integer `offset`, a positive
  integer `length`, a safe `segmentObjectKey`, and a safe
  `segmentDeliveryUrl`; byteranges are valid only on parts.

### 8.5.1 PRELOAD-HINT

```
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="<uri>",BYTERANGE-START=<offset+length>
```

Emitted only when the last committed part of the in-progress (partial)
segment uses byterange addressing. `URI` is the virtual segment URL
and `BYTERANGE-START` is that part's `offset + length` — the byte at
which the next part will land. No `BYTERANGE-LENGTH` is emitted (the
next part's size is unknown), so the hinted request is open-ended and
is served per Section 7.10. Per-part-URI sessions emit no preload
hints: future per-part URLs would be deterministic guesses whose 404s
could poison caches (Section 10.4).

## 8.5.2 End of stream

<!-- olos-conformance: 8.5.2 HLS-ENDLIST-001 -->

When the session (equivalently, the cursor's `state`) is terminal —
`ended` or `aborted` — every media playlist MUST end with
`#EXT-X-ENDLIST` so players stop polling. Live states MUST NOT emit
it. Even with `EXT-X-ENDLIST` present, `EXT-X-PLAYLIST-TYPE` remains
omitted (Section 8.4): the window may still slide as retention prunes.

## 8.6 Blocking playlist reload

<!-- olos-conformance: 8.6 HLS-BLOCK-001 HLS-BLOCK-002 HLS-BLOCK-003 -->

Media playlist requests MAY carry `_HLS_msn` and `_HLS_part` query
parameters (RFC 8216 LL-HLS blocking reload).

Parsing:

- Absent parameters mean "serve immediately".
- Present parameters MUST be non-negative integers; anything else is
  `400`.
- `_HLS_part` without `_HLS_msn` is invalid: `400`.

Resolution against the cursor (`cursor.window` is the live edge; see
Section 5):

| Condition | Result |
| --- | --- |
| No `_HLS_msn` | ready |
| `_HLS_msn > window.lastMediaSequenceNumber` | block |
| `_HLS_msn < window.lastMediaSequenceNumber` | ready (regardless of `_HLS_part`) |
| `_HLS_msn == last` and no `_HLS_part` | ready |
| `_HLS_msn == last` and `_HLS_part > window.lastPartNumber` | block |
| `_HLS_msn == last` and `_HLS_part <= window.lastPartNumber` | ready |

On a segment-only window (`window.lastPartNumber` absent), part
requests at the last MSN never block: the segment is already complete.

Blocking behavior:

- A blocked request MUST be held open until a newer cursor satisfies
  the resolution, or the configured timeout elapses. Each new cursor
  is re-resolved with the same table.
- A successful commit that advances the cursor MUST wake waiting
  requests (Section 6.5.2); rejected commits MUST NOT wake anyone.
- **Timeout is not an error**: the response is `200` with the playlist
  rendered from the latest cursor observed, exactly as a non-blocking
  request would have received.
- A zero timeout degrades to non-blocking behavior.
- The wait deadline is computed from a monotonic-enough clock in epoch
  milliseconds. Implementations MAY inject this clock (the `now`
  option of the reference waiter) — deadline arithmetic MUST use it
  consistently for both the initial deadline and remaining-time
  checks, so tests and embedders can drive time deterministically.
- After a `ready` or `timeout` wait, the playlist MUST be rendered
  from the cursor returned by the wait (never a stale pre-wait
  snapshot), and end-of-stream detection (Section 8.5.2) MUST use that
  cursor's state.

## 8.7 Examples (informative)

The examples below are normative *illustrations* of the rules above,
not byte-golden requirements; URLs and identifiers are placeholders.

Master playlist with an audio group:

```
#EXTM3U
#EXT-X-VERSION:10
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="/v1/live/sess_01JZLIVE/a128/media.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="a64",DEFAULT=NO,AUTOSELECT=YES,URI="/v1/live/sess_01JZLIVE/a64/media.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,AVERAGE-BANDWIDTH=5000000,CODECS="avc1.640028,mp4a.40.2,ec-3",RESOLUTION=1920x1080,FRAME-RATE=30,AUDIO="aac"
/v1/live/sess_01JZLIVE/v1080/media.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,AVERAGE-BANDWIDTH=2800000,CODECS="avc1.4d401f,mp4a.40.2,ec-3",RESOLUTION=1280x720,FRAME-RATE=30,AUDIO="aac"
/v1/live/sess_01JZLIVE/v720/media.m3u8
```

Media playlist (two full segments, one in-progress segment with two
per-part-URI parts; nonce-bearing object keys per Section 7.5):

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

Note `#EXT-X-MEDIA-SEQUENCE:3810` matches the first listed segment's
MSN (Section 8.4.2), and no preload hint appears because the parts use
per-part URIs (Section 8.5.1).
