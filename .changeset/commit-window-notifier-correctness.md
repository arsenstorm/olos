---
"@arsenstorm/olos": minor
---

Commit-path, retention, and cursor-notifier correctness fixes:

- A multi-rendition session no longer fails a rendition's first media
  commit when it arrives out of order (part 1 before part 0). The commit
  is recorded and the rendition stays out of the committed window until
  its contiguous prefix starts, per spec §5.2/§5.3. Previously the
  window build threw, the commit was lost, and the request failed.
- An identical commit retry that arrives after the slot deadline now
  returns the idempotent success the spec mandates (§4.5.1/§4.5.2).
  Duplicate resolution compares against the stored commit with
  `committedAt` excluded, so the deadline check no longer rejects
  retries of commits that were accepted on time. New late commits still
  reject.
- Retention retirement is now per rendition: a commit retires when its
  own rendition's visible window has moved past it, not when the
  window-global minimum has. Previously one lagging rendition kept every
  other rendition's trimmed commits (and their slots) in state forever
  and their objects were never surfaced for deletion.
- Session transitions now notify the cursor notifier. Blocking reloads
  parked when a session ends resolve immediately with the terminal
  cursor (`#EXT-X-ENDLIST`) instead of sleeping to the reload timeout
  and serving a stale playlist, and ended sessions are evicted from the
  notifier's memory instead of being retained indefinitely.
- The cursor notifier now wakes waiters when a notified cursor changes
  window content at an unchanged global position — for example a
  full-segment commit at the live-edge media sequence number, or a
  lagging rendition completing a segment. Per-rendition blocking reloads
  no longer miss those updates and wait out the timeout.
- Publisher-lease recency in `/health` compares timestamp instants, so
  RFC 3339 offsets other than `Z` order correctly.
