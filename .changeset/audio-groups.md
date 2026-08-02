---
"@arsenstorm/olos": minor
---

Proper multi-audio support via `#EXT-X-MEDIA:TYPE=AUDIO` groups:

- `Rendition` gains optional `groupId`, `name`, and `defaultRendition`
  fields (audio renditions only) for HLS audio group membership.
- Sessions with grouped audio renditions render one
  `#EXT-X-MEDIA:TYPE=AUDIO` entry per audio rendition, wire variant
  streams to the group with `AUDIO="<groupId>"`, list only the distinct
  grouped audio codecs in `CODECS`, and emit a media playlist artifact
  per grouped audio rendition.
- One audio group per session for now: multiple distinct group IDs,
  multiple default audio renditions, and mixing grouped with ungrouped
  audio renditions are rejected.
- Sessions without audio group IDs render exactly as before.
