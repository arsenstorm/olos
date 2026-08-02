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
- Blocking reloads against a terminal (`ended`/`aborted`) cursor resolve
  immediately with the final ENDLIST playlist instead of holding the
  request open for the full timeout — no further cursor can ever satisfy
  the request. The internal `isEndOfStreamSessionState` helper moved from
  the HLS manifest artifact module to `olos/src/state/session.ts` (it was
  never part of a public facade).
- `#EXT-X-DISCONTINUITY-SEQUENCE` is per-rendition too: `RenditionWindow`
  gains an optional `discontinuitySequence` that the renderer prefers over
  the window-global value, and window construction counts trimmed leading
  segments marked `discontinuityBefore` into it. Windows built from commits
  keep the field absent (commits carry no discontinuity markers yet).
- The master playlist and the manifest artifact set now include only
  renditions present in the committed window. A rendition that has not
  committed media yet (init-only, or not yet publishing) no longer makes
  playlist rendering throw and fail every playlist request for the
  session; its media route is 404 until media commits, and the master
  picks it up on the next request after its first commit. A session with
  committed audio but no committed video serves no master playlist yet
  (404). `renderMasterPlaylist` gains the optional `availableRenditionIds`
  option that implements the filter; omitted, it renders every session
  rendition as before.
