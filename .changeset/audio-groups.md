---
"@arsenstorm/olos": minor
---

Multi-audio support through `#EXT-X-MEDIA:TYPE=AUDIO` groups:

- `Track` gains the optional `groupId`, `name`, and `defaultTrack`
  fields for HLS audio group membership. Only audio tracks can carry
  them.
- If a session has grouped audio tracks, the master playlist renders
  one `#EXT-X-MEDIA:TYPE=AUDIO` entry per audio track with committed
  media. Variant streams point to the group with `AUDIO="<groupId>"`, and
  `CODECS` lists only the distinct rendered grouped audio codecs. Each
  grouped audio track gets its own media playlist artifact once it has
  committed media; tracks absent from the committed window are not
  advertised in the master and get no media playlist artifact.
- `AUTOSELECT` is `YES` only on the group's default track and `NO` on
  the rest. Tracks carry no language or characteristics attributes, so
  RFC 8216 §4.3.4.1.1 allows only one auto-selectable member per group.
- One audio group per session for now. Validation rejects multiple distinct
  group IDs, multiple default audio tracks, and a mix of grouped and
  ungrouped audio tracks.
- A session without audio group IDs renders exactly as before.
