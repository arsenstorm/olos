# 05 Committed window

The committed window is the retained, viewer-visible span of committed
media (Section 3.9). This section defines how the window is derived from
accepted commits. It also defines the invariants that every window MUST
satisfy. Manifests are rendered exclusively from the committed window
(Section 2.3, Section 08).

## 5.1 Structure and validity

<!-- olos-conformance: 5.1 CORE-WINDOW-003 CORE-WINDOW-004 CORE-WINDOW-005 -->

A committed window is built from the session's accepted init commits and
media commits.

- Every contributing commit MUST carry the window's `sessionId` and
  `epoch`. Commits from another session or epoch MUST be rejected.
- Every rendition that has media commits MUST have exactly one init
  commit. A rendition with media commits but no init commit is an error.
  Duplicate init commits for one rendition MUST be rejected.
- Within each rendition window, segments MUST be ordered by strictly
  increasing `mediaSequenceNumber`. Duplicate segment positions MUST be
  rejected, whether they collide inside one segment entry or across
  distinct entries.
- Within each segment, parts MUST be ordered by strictly increasing
  `partNumber`. Duplicate part positions MUST be rejected, whether the
  parts reference the same delivery URL or different delivery URLs.
- Every rendered segment MUST contain committed media: a full segment
  object, a non-empty part list, or both. Gaps between segment MSNs are
  permitted. Ordering MUST still be monotonic across the gap.
- Delivery URLs and object keys inside the window MUST satisfy the
  safety rules of Section 1.3.

## 5.2 Contiguous-parts prefix rule

<!-- olos-conformance: 5.2 CORE-WINDOW-007 -->

Within a segment, parts become viewer-visible only as a contiguous prefix
numbered from 0:

- The visible parts of a segment are the longest prefix
  `0, 1, 2, ... n` of committed part numbers with no gap. Committed
  parts at or beyond the first gap MUST NOT appear in the window.
- A segment whose only committed parts lie beyond a gap (for example
  part 3 committed before parts 0-2) has no visible parts. If it also
  has no full segment object, it MUST NOT be rendered at all. If no
  rendition has any renderable segment, the window does not yet exist.
- Part numbers hidden by the prefix rule MUST NOT leak into the cursor.
  The cursor's `lastPartNumber` reflects only visible parts
  (Section 5.6).

## 5.3 Out-of-order commit tolerance

A commit at a position that is not yet contiguous is not an error:

- The coordinator MUST accept and record a commit whose part position
  is ahead of the contiguous prefix (subject to the acceptance rules of
  Section 4.5). The commit MUST NOT advance the cursor until the prefix
  completes.
- When a later commit fills the gap, all previously recorded parts that
  are now contiguous become visible together. The cursor then advances
  in a single step.
- A recorded out-of-order commit MUST NOT trigger retention of the
  waiting object. An object ahead of the live edge is not "behind the
  window" (Section 09).

Out-of-order commits remain subject to the lateness rules of
Section 4.5.3. Only positions ahead of the cursor can wait.

## 5.4 Duplicate positions

<!-- olos-conformance: 5.4 CORE-COMMIT-008 -->

Each timeline position accepts at most one committed object per role:

- At most one full-segment commit MAY exist per (`renditionId`, MSN).
  A second full-segment commit at an occupied position MUST be
  rejected.
- At most one part commit MAY exist per (`renditionId`, MSN,
  `partNumber`). A duplicate part position MUST be rejected.
- A full segment and parts MAY coexist at the same MSN. The parts
  describe the in-progress segment. The full segment describes its
  completed form (Section 5.5, Section 08).

Re-commits of the same slot are resolved by the idempotency rules of
Section 4.5.2 before any duplicate-position check applies.

## 5.5 Segment durations

- **Parts-only segments.** While a segment has visible parts but no full
  segment object, its `duration` MUST equal the sum of the visible
  (contiguous) parts' durations. The duration grows as the prefix
  extends.
- **Full segments.** Once a full-segment commit exists at a position,
  that commit's `duration` is authoritative for the segment, including
  when parts are also present.

## 5.6 Last visible part number

The window's last visible part number is the highest `partNumber` among
the visible parts of segments at the window's `lastMediaSequenceNumber`,
taken across all renditions. It is undefined when no rendition's last
segment sits at that MSN with visible parts. One such case is a last
segment that is a completed full segment without parts. When the value is
undefined, the cursor's `window.lastPartNumber` MUST be absent. Otherwise
it MUST equal this value (Section 3.8, Section 4.7).

## 5.7 Window trimming

An implementation MAY bound the window with a `maxSegments` limit, which
MUST be a positive integer:

- When a rendition window holds more than `maxSegments` renderable
  segments, only the newest `maxSegments` segments (the tail of the
  ordered list) are retained. The oldest segments fall off the front.
- Trimming MUST preserve the ordering and uniqueness invariants of
  Section 5.1.
- Objects trimmed out of the window become eligible for retention
  (Section 09).

## 5.8 Media sequence range

The window's MSN bounds are derived from its renditions:

- `firstMediaSequenceNumber` MUST equal the minimum segment MSN across
  all renditions. `lastMediaSequenceNumber` MUST equal the maximum. The
  first MUST NOT exceed the last.
- Individual renditions MAY start later than the window-global minimum
  (per-rendition trimming or empty-media segments can drop leading
  segments), so a rendition's first segment MSN MAY exceed
  `firstMediaSequenceNumber`.
- As a result, each rendition's media playlist MUST declare its media
  sequence from that rendition's own first rendered segment, not from
  the window-global minimum. The playlist mapping is specified in
  Section 08.

The `epoch` and `discontinuitySequence` fields carried by the window are
defined in Section 3.9. Discontinuity signaling in playlists is covered
in Section 08.
