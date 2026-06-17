# OLOS LL-HLS Mapping

Status: `draft-v0.1.2`

## 1. Abstract

The OLOS LL-HLS Mapping defines how an OLOS cursor and `CommittedWindow` are rendered as standards-compatible Low-Latency HLS playlists.

OLOS does not replace HLS. The manifest gateway generates HLS from trusted OLOS state.

## 2. Inputs

The HLS mapping consumes:

```text
OLOS Cursor
OLOS CommittedWindow
Session metadata
Rendition metadata
Pathway metadata
Latency profile
Security policy
```

It MUST NOT consume publisher-uploaded playlist text.

## 3. Outputs

The mapping emits:

```text
master playlist
media playlists
optional content steering data
```

Official playback manifests MUST include committed media only. In direct-public deployments, this does not imply that uncommitted objects are technically unreadable if their direct object URLs are known.

## 4. Master playlist

Example:

```m3u8
#EXTM3U
#EXT-X-VERSION:10
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=5500000,AVERAGE-BANDWIDTH=5000000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=30
/v1/live/sess_01JZLIVE/v1080/media.m3u8
```

Requirements:

```text
gateway MUST generate the playlist
gateway MUST restrict rendition URIs to approved relative or same-service URLs
gateway MUST NOT include publisher-supplied absolute URLs
gateway SHOULD include stable CODECS, BANDWIDTH and RESOLUTION attributes
```

## 5. Media playlist

Example rendered from the `CommittedWindow` in `02-core.md`:

```m3u8
#EXTM3U
#EXT-X-VERSION:10
#EXT-X-TARGETDURATION:2
#EXT-X-PART-INF:PART-TARGET=0.500
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.500,HOLD-BACK=6.000
#EXT-X-MEDIA-SEQUENCE:3810
#EXT-X-DISCONTINUITY-SEQUENCE:0
#EXT-X-MAP:URI="https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/init-slot_init_v1080.mp4"

#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:00.000Z
#EXTINF:2.000,
https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3810/segment-slot_s3810.m4s
#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:02.000Z
#EXTINF:2.000,
https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3811/segment-slot_s3811.m4s
#EXT-X-PROGRAM-DATE-TIME:2026-06-08T12:00:04.000Z
#EXT-X-PART:DURATION=0.500,INDEPENDENT=YES,URI="https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p0-slot_3812_0.m4s"
#EXT-X-PART:DURATION=0.500,URI="https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p1-slot_3812_1.m4s"
#EXT-X-PART:DURATION=0.500,URI="https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p2-slot_3812_2.m4s"
#EXT-X-PART:DURATION=0.500,URI="https://media.example.com/media/tenant_acme/sess_01JZLIVE/e1/v1080/s3812/p3-slot_3812_3.m4s"
```

## 6. CommittedWindow mapping

The `CommittedWindow` is the normative HLS rendering input.

A gateway MUST render the media playlist from the committed window, not from object-store listing, publisher-provided sequence numbers, or guessed future object keys.

| CommittedWindow field | HLS output |
|---|---|
| `partTarget` from cursor/session | `#EXT-X-PART-INF:PART-TARGET` |
| `segmentTarget` from cursor/session | `#EXT-X-TARGETDURATION` |
| `committedWindow.firstMediaSequenceNumber` | `#EXT-X-MEDIA-SEQUENCE` |
| `committedWindow.discontinuitySequence` | `#EXT-X-DISCONTINUITY-SEQUENCE` |
| `rendition.init.deliveryUrl` | `#EXT-X-MAP` |
| `segment.discontinuityBefore` | `#EXT-X-DISCONTINUITY` before that segment |
| `segment.programDateTime` | `#EXT-X-PROGRAM-DATE-TIME` |
| `segment.segment.deliveryUrl` | `#EXTINF` + segment URI |
| `segment.parts[].deliveryUrl` | `#EXT-X-PART` |
| `segment.parts[].duration` | `#EXT-X-PART:DURATION` |
| `segment.parts[].independent` | `#EXT-X-PART:INDEPENDENT=YES`, when true |
| `pathway.baseUrl` or resolved `deliveryUrl` | Media URI authority/pathway |

The gateway MUST preserve the order of `segments` and `parts` as committed by the coordinator. It MUST reject or refuse to render a committed window whose entries are non-monotonic within a rendition.

## 7. Required committed-window properties

For each rendered rendition, the committed window MUST contain:

```text
an init object with a delivery URL
at least one committed segment or part inside the requested live window
monotonic media sequence numbers
monotonic part numbers inside a media sequence
positive durations
no duplicate {epoch, renditionId, mediaSequenceNumber, partNumber} positions
no duplicate non-identical delivery URLs for the same timeline position
```

If a full segment and its parts are both present, the gateway MAY render the full segment for completed historical media and parts for the live-edge segment. A gateway SHOULD NOT render both a full segment URI and all of its parts for the same completed segment unless the selected HLS profile explicitly requires that representation.

## 8. Hold-back

For `object-ll`, the gateway SHOULD use:

```text
PART-HOLD-BACK = max(3 * partTarget, configured minimum)
HOLD-BACK = max(3 * targetDuration, configured minimum)
```

The gateway MUST NOT advertise hold-back values that clients cannot realistically satisfy.

## 9. Blocking reload

The gateway SHOULD support blocking playlist reload.

Logical behaviour:

```text
if request asks for msn/part beyond current cursor:
  hold the request until that part is committed or timeout occurs
else:
  return current playlist immediately
```

The blocking reload implementation MUST observe the trusted cursor and committed window, not storage object listing.

## 10. Preload hints

In OLOS-Object mode, `#EXT-X-PRELOAD-HINT` is disabled by default.

Rationale:

```text
future object URLs may be requested before upload completion
404s can be cached by delivery infrastructure
object stores cannot serve an unfinished object
```

A gateway MAY enable preload hints only if:

```text
future-object requests are routed through a blocking gateway; or
the delivery path guarantees no negative caching for hinted live objects; or
the provider profile declares safe preload-hint behaviour.
```

A gateway MUST NOT emit deterministic future object URLs in preload hints for direct-public object-store mode unless the provider profile proves that future-object 404s cannot poison playback.

## 11. Rendition reports

The gateway MAY emit `#EXT-X-RENDITION-REPORT` for multi-rendition playback once the committed windows for those renditions are synchronised.

## 12. Content steering

The gateway MAY map OLOS pathways to HLS Content Steering.

Example mapping:

```text
OLOS pathway r2-primary -> HLS pathway r2
OLOS pathway s3-backup -> HLS pathway s3
```

The gateway MUST NOT accept publisher-supplied content-steering URLs.

## 13. Revoked or unsafe committed slots

If a slot is revoked before announcement, the gateway MUST omit it from official manifests.

If a slot has already been announced, the gateway MUST NOT silently replace it with another object at the same timeline position. The coordinator/gateway MUST instead use one of the behaviours defined by OLOS Core:

```text
freeze playlist advancement
abort the session
start a new epoch or discontinuity after the last safe position
disable or read-gate the affected pathway
```

## 14. Security requirements

The HLS gateway MUST:

```text
escape playlist values
reject control characters in generated URI components
allow only approved URI schemes and authorities
never emit publisher-supplied absolute media URLs
never emit publisher-supplied EXT-X-KEY URIs
never emit publisher-supplied subtitle or rendition URIs
never use object listing as playlist source of truth
```

## 15. Cache requirements

Media playlists SHOULD use short cache lifetimes or no-store depending on deployment.

Media object URLs SHOULD be immutable and cacheable.

The gateway SHOULD NOT emit URLs for objects that have not been committed.

## 16. Required v0.1.2 build items

```text
master playlist renderer
media playlist renderer from CommittedWindow
EXT-X-MAP support
EXT-X-PART support
EXT-X-SERVER-CONTROL support
blocking reload
preload hints disabled by default
URI allow-listing
golden manifest tests
revoked-slot behaviour tests
```
