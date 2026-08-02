---
"@arsenstorm/olos": minor
---

Multi-audio support through `#EXT-X-MEDIA:TYPE=AUDIO` groups:

- `Rendition` gains the optional `groupId`, `name`, and `defaultRendition`
  fields for HLS audio group membership. Only audio renditions can carry
  them.
- If a session has grouped audio renditions, the master playlist renders
  one `#EXT-X-MEDIA:TYPE=AUDIO` entry per audio rendition. Variant streams
  point to the group with `AUDIO="<groupId>"`, and `CODECS` lists only the
  distinct grouped audio codecs. Each grouped audio rendition gets its own
  media playlist artifact.
- One audio group per session for now. Validation rejects multiple distinct
  group IDs, multiple default audio renditions, and a mix of grouped and
  ungrouped audio renditions.
- A session without audio group IDs renders exactly as before.
