---
"@arsenstorm/olos": minor
---

HLS playlist correctness fixes:

- `#EXT-X-MEDIA-SEQUENCE` now comes from the rendered rendition's own first
  segment instead of the window-global minimum. Playlists stay correct when
  renditions diverge through per-rendition trimming or dropped empty-media
  segments.
- Media playlists for ended or aborted sessions now end with
  `#EXT-X-ENDLIST`, so players stop polling terminal sessions. The new
  `endOfStream` option on `renderMediaPlaylist` controls this, and the
  cursor or session state sets it automatically. These sliding-window
  playlists still omit `EXT-X-PLAYLIST-TYPE` by design.
- A parts-only in-progress segment now reports the sum of its contiguous
  part durations instead of the duration of the first part. A full-segment
  commit keeps its authoritative duration.
