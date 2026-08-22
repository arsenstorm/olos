# 5. Committed window

The committed window is the retained, viewer-visible span of committed
objects (Section 3.9). This section defines how the coordinator derives
the window from accepted commits. It also defines the invariants that
every window MUST satisfy. Delivery documents are rendered exclusively
from the committed window (Section 2.3, Section 8).

## 5.1 Structure and validity

<!-- olos-conformance: 5.1 CORE-WINDOW-003 CORE-WINDOW-004 CORE-WINDOW-005 -->

A committed window is built from the session's accepted init commits and
segment and part commits. It carries `epoch`, `firstSequenceNumber`,
`lastSequenceNumber`, and `tracks`, a map from `trackId` to a track
window `{ trackId, init?, profile?, segments }` (Section 3.9). Each
committed object in the window carries the `profile` of the commit that
produced it, unchanged.

- Every contributing commit MUST carry the window's `sessionId` and
  `epoch`. Commits from another session or epoch MUST be rejected.
- A track MAY have at most one init commit. Duplicate init commits for
  one track MUST be rejected. A track with segment or part commits but
  no init commit is valid in Core. Its track window has no `init`. A
  profile MAY require an init object per track (the CMAF/LL-HLS profile
  does, Section 8).
- Within each track window, segments MUST be ordered by strictly
  increasing `sequenceNumber`. Duplicate segment positions MUST be
  rejected, whether they collide inside one segment entry or across
  distinct entries.
- Within each segment, parts MUST be ordered by strictly increasing
  `partNumber`. Duplicate part positions MUST be rejected, whether the
  parts reference the same delivery URL or different delivery URLs.
- Every rendered segment MUST contain committed objects: a full segment
  object, a non-empty part list, or both. Gaps between segment sequence
  numbers are permitted. Ordering MUST still be monotonic across the
  gap.
- Delivery URLs and object keys inside the window MUST satisfy the
  safety rules of Section 1.3.

## 5.2 Contiguous-parts prefix rule

<!-- olos-conformance: 5.2 CORE-WINDOW-007 -->

Within a segment, parts become viewer-visible only as a contiguous prefix
numbered from 0:

- The visible parts of a segment are the longest prefix
  `0, 1, 2, ... n` of committed part numbers with no gap. Committed
  parts at or beyond the first gap MUST NOT appear in the window.
- A segment whose only committed parts are beyond a gap (for example
  part 3 committed before parts 0-2) has no visible parts. If it also
  has no full segment object, it MUST NOT be rendered at all. If no
  track has any renderable segment, the window does not yet exist.
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
  window" (Section 9).

Out-of-order commits remain subject to the lateness rules of
Section 4.5.3. Only positions ahead of the cursor can wait.

## 5.4 Duplicate positions

<!-- olos-conformance: 5.4 CORE-COMMIT-008 -->

Each timeline position accepts at most one committed object per role:

- At most one full-segment commit MAY exist per (`trackId`,
  `sequenceNumber`). A second full-segment commit at an occupied
  position MUST be rejected.
- At most one part commit MAY exist per (`trackId`, `sequenceNumber`,
  `partNumber`). A duplicate part position MUST be rejected.
- A full segment and parts MAY coexist at the same sequence number. The
  parts describe the in-progress segment. The full segment describes
  its completed form (Section 5.5, Section 8).

Re-commits of the same slot are resolved by the idempotency rules of
Section 4.5.2 before the duplicate-position rules apply.

## 5.5 Segment durations

Core gives a position no time meaning. A sequence number orders segments.
A part number orders parts within a segment. Durations, wall-clock
timestamps, and any other timing facts are profile data. A profile
defines them inside the `profile` object of a slot, commit, and committed
object. Core carries that object through the window unchanged
(Section 4.5.1).

A profile that defines durations MUST also define how a segment's
duration is derived. Segments are described by parts, by a full segment
object, or by both. Under the CMAF/LL-HLS profile, every segment and
part object carries `profile.duration` (Section 8.4.3).

## 5.6 Last visible part number

The window's last visible part number is the highest `partNumber` among
the visible parts of segments at the window's `lastSequenceNumber`,
taken across all tracks. It is undefined when no track's last segment is
at that sequence number with visible parts. One such case is a last
segment that is a completed full segment without parts. When the value
is undefined, the cursor's `window.lastPartNumber` MUST be absent. When
`window.lastPartNumber` is present, it MUST equal this value
(Section 3.8, Section 4.7).

## 5.7 Window trimming

An implementation MAY bound the window with a `maxSegments` limit, which
MUST be a positive integer:

- When a track window holds more than `maxSegments` renderable
  segments, only the newest `maxSegments` segments (the tail of the
  ordered list) are retained.
- Trimming MUST preserve the ordering and uniqueness invariants of
  Section 5.1.
- Objects trimmed out of the window become eligible for retention
  (Section 9).

Trimming is per track. The window build MAY take a profile-supplied
track-window `profile` hook. For each track the hook receives the
`trackId`, the visible segments, and the segments trimmed off the front,
both oldest first. It returns the track window's `profile` or nothing.
Core stores the returned object unchanged, and omits `profile` when the
hook returns nothing. The CMAF/LL-HLS profile uses the hook to count
trimmed segments flagged `discontinuityBefore` into the track window's
`discontinuitySequence` (Section 8).

## 5.8 Sequence number range

The window's sequence number bounds are derived from its tracks:

- `firstSequenceNumber` MUST equal the minimum segment sequence number
  across all tracks. `lastSequenceNumber` MUST equal the maximum. The
  first MUST NOT exceed the last.
- A track's first segment sequence number MAY exceed
  `firstSequenceNumber`. Per-track trimming or empty segments can drop
  leading segments.
- A session track MAY be entirely absent from the window until its
  first segment or part commit is accepted. Renderers MUST NOT treat
  that absence as an error.
- A renderer that declares a per-track starting sequence MUST derive it
  from that track's own first rendered segment (Section 8.4.2).

The `epoch` field carried by the window is defined in Section 3.9.
Discontinuity signaling is profile data (Section 5.7). Its playlist
rendering is covered in Section 8.
