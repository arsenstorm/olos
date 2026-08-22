---
"@arsenstorm/olos": minor
---

HLS blocking reload and audio-group fixes:

- `HlsBlockingReloadRequest` gains an optional `trackId`. When set,
  blocking reloads resolve against that track's own committed-window
  bounds (its last visible segment and part) instead of the window-global
  live edge, so a lagging track blocks until its own playlist changes.
  Requests without a `trackId` keep the window-global behavior, and
  `parseHlsBlockingReloadRequest` never sets it — the blocking manifest
  resolver attaches the track it routes to. The new
  `trackWindowBounds` helper in `olos/src/state/committed-window.ts`
  exposes a track's own live edge.
- Blocking playlist requests for unknown paths now answer 404 immediately
  instead of being held open for up to `timeoutMs` — bogus paths can no
  longer pin waiters.
- Delivery directives (`_HLS_msn` / `_HLS_part`) on the master playlist
  path are a 400 (they apply to media playlist requests, RFC 8216bis
  §6.2.5.1), and an `_HLS_msn` more than two beyond the requested
  track's live edge is a 400 as well (RFC 8216bis §6.2.5.2; exactly
  the live edge plus two still blocks).
- A blocking playlist request now renders only the artifact it asked for —
  the master playlist or the one requested track's media playlist —
  instead of the session's full playlist set on every request. The
  render-all `createHlsManifestArtifacts` and
  `createCoordinatorManifestArtifacts` are unchanged for artifact
  publishing and non-blocking serving.
- Quoted playlist attribute values are validated instead of
  backslash-escaped: RFC 8216 §4.2 quoted-strings have no escape
  mechanism, so `escapePlaylistValue` (whose `\"` sequences players parse
  literally) is replaced by `quotedPlaylistValue`, which throws on double
  quotes, carriage returns, and line feeds and otherwise returns the value
  verbatim. `assertSession` rejects track names containing those
  characters.
- Duplicate effective `NAME`s (`name ?? trackId`) within an audio
  group are rejected by both `assertSession` and master playlist rendering
  — duplicate names are ambiguous to players.
- The audio group's DEFAULT/AUTOSELECT election is stable: the
  session-elected default (the flagged track, else the first declared
  grouped track) no longer flips with committed-window availability.
  While the elected default has no committed media, every rendered member
  carries `DEFAULT=NO,AUTOSELECT=NO`; once it commits, it renders
  `DEFAULT=YES,AUTOSELECT=YES` permanently.
