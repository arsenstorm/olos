---
"@arsenstorm/olos": minor
---

HLS playlist correctness fixes:

- `#EXT-X-MEDIA-SEQUENCE` is now derived from the rendered rendition's own
  first segment instead of the window-global minimum, so playlists stay
  correct when renditions diverge (per-rendition trimming, dropped
  empty-media segments).
- Media playlists for ended/aborted sessions now terminate with
  `#EXT-X-ENDLIST` (new `endOfStream` option on `renderMediaPlaylist`,
  derived automatically from the cursor/session state), so players stop
  polling terminal sessions. `EXT-X-PLAYLIST-TYPE` is deliberately still
  omitted for these sliding-window playlists.
- Parts-only in-progress segments now report the sum of their contiguous
  part durations instead of the first part's duration; full-segment commits
  keep their authoritative duration.
