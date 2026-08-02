---
"@arsenstorm/olos": minor
---

Multi-audio support through `#EXT-X-MEDIA:TYPE=AUDIO` groups:

- `Rendition` gains the optional `groupId`, `name`, and `defaultRendition`
  fields for HLS audio group membership. Only audio renditions can carry
  them.
- If a session has grouped audio renditions, the master playlist renders
  one `#EXT-X-MEDIA:TYPE=AUDIO` entry per audio rendition with committed
  media. Variant streams point to the group with `AUDIO="<groupId>"`, and
  `CODECS` lists only the distinct rendered grouped audio codecs. Each
  grouped audio rendition gets its own media playlist artifact once it has
  committed media; renditions absent from the committed window are not
  advertised in the master and get no media playlist artifact.
- `AUTOSELECT` is `YES` only on the group's default rendition and `NO` on
  the rest. Renditions carry no language or characteristics attributes, so
  RFC 8216 §4.3.4.1.1 allows only one auto-selectable member per group.
- One audio group per session for now. Validation rejects multiple distinct
  group IDs, multiple default audio renditions, and a mix of grouped and
  ungrouped audio renditions.
- A session without audio group IDs renders exactly as before.
