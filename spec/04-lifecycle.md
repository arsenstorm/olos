# 04 Lifecycle

This section defines the normative state machine that turns uploads into
stream state: session states, slot issuance, upload observation, commit
acceptance, publisher leases, and cursor advancement.

## 4.1 Session states

A session is in exactly one of four states:

| State     | Meaning                                                    |
| --------- | ---------------------------------------------------------- |
| `live`    | Accepting slots, uploads, and commits.                     |
| `ending`  | Winding down; no longer the target of new media.           |
| `ended`   | Terminal; the stream completed normally.                   |
| `aborted` | Terminal; the stream was cancelled.                        |

The only permitted transitions are:

- `live` -> `ending`
- `live` -> `aborted`
- `ending` -> `ended`

An implementation MUST reject any other transition, including transitions
out of `ended` or `aborted` and self-transitions. When a session
transitions, an existing cursor's `state` field MUST be updated to the new
session state in the same operation.

Commits against an `aborted` session MUST be rejected with
`olos.invalid_state` (Section 4.5). Publisher heartbeats for sessions in a
terminal state (`ended` or `aborted`) MUST be rejected (Section 4.6).

## 4.2 Slot issuance

<!-- olos-conformance: 4.2 CORE-SLOT-001 CORE-SLOT-002 CORE-SLOT-006 -->

A slot is the only way to reserve a position in a session's timeline.

- The coordinator MUST NOT issue a slot unless the session state is
  `live`.
- `renditionId` MUST name a rendition declared by the session; the
  coordinator MUST reject issuance for any other rendition.
- `slotId` MUST be unique among all slots ever issued for the session;
  the coordinator MUST reject a duplicate `slotId`.
- The issued slot MUST carry the session's `sessionId` and `epoch`, and
  MUST be created in state `issued`.
- The coordinator derives `objectKey` from the slot's kind and position
  (`media/<renditionId>/init[-<nonce>].mp4`,
  `media/<renditionId>/s<msn>[-<nonce>].m4s`,
  `media/<renditionId>/s<msn>/p<part>[-<nonce>].m4s`; layout details in
  Section 07) and `deliveryUrl` by appending the object key to the
  session's media base URL.
- In the direct-public publication mode, if the caller supplies no
  `objectKeyNonce`, the coordinator MUST generate a cryptographically
  random nonce (the reference implementation uses 128 bits) so object
  keys are unguessable (Section 10).
- `expiresAt`, `contentType`, `duration`, `maxBytes`, and optional
  `minBytes`, `partNumber`, and `byterange` are fixed at issuance and
  MUST NOT change for the lifetime of the slot. `byterange` is only valid
  on `part`-kind slots (Section 3.3.1).

Upload grants for issued slots are covered in Section 07.

## 4.3 Slot states and expiry

<!-- olos-conformance: 4.3 CORE-SLOT-004 CORE-SLOT-005 -->

A slot moves through the following states; any transition not listed MUST
be rejected:

| From              | Permitted transitions                          |
| ----------------- | ---------------------------------------------- |
| `issued`          | `upload_observed`, `expired`, `revoked`        |
| `upload_observed` | `committed`, `rejected`, `revoked`             |
| `committed`       | `revoked`                                      |
| `expired`         | (terminal)                                     |
| `rejected`        | (terminal)                                     |
| `revoked`         | (terminal)                                     |

Rules:

- **Expiry.** An `issued` slot MAY be moved to `expired` only at or after
  its `expiresAt` deadline; expiring a slot before its deadline MUST be
  rejected. Expiring an already-`expired` slot is idempotent.
- **Rejection.** Only an `upload_observed` slot may be `rejected` (the
  observed object was refused). Rejecting an already-`rejected` slot is
  idempotent.
- **Revocation** is defined in Section 4.8. Revoking an
  already-`revoked` slot is idempotent.
- Idempotent re-application of a terminal transition MUST NOT alter the
  slot or any other state.

## 4.4 Upload observation

<!-- olos-conformance: 4.4 CORE-EVENT-001 CORE-EVENT-002 CORE-EVENT-003 CORE-EVENT-004 CORE-EVENT-005 -->

The coordinator learns that an object exists through one of three paths:

1. **Storage read** — a direct read of object metadata (for
   S3-compatible stores, `HeadObject`; Section 07), normalized into an
   observed upload whose `observedAt` is the object's last-modified time.
2. **Provider event** — an `object.created` event delivered by the
   storage provider, carrying an `eventId`, event time, and the object's
   key, content type, size, and optional etag and metadata.
3. **Completion hint** — an `upload.completed` hint posted by the
   publisher, carrying an `eventId`, event time, `objectKey`, and
   `slotId`.

Precedence and proof:

- Paths 1 and 2 are **object proof**. A completion hint is NOT proof: on
  a hint alone the coordinator MUST keep the slot uncommitted and await
  object proof.
- When both a hint and object proof are present they MUST agree on
  `objectKey`; a disagreement MUST be rejected with `olos.key_mismatch`.
- `object.created` events MUST be de-duplicated by `eventId`: an event
  whose `eventId` has already been observed MUST be treated as an
  idempotent duplicate with no further effect.
- An `object.created` event whose object key matches no known slot MUST
  be rejected with `olos.unknown_slot`.
- Events of an unsupported type or with malformed payloads MUST be
  rejected.

Observation applies to a slot in state `issued` or `upload_observed`
(idempotent in the latter case) and moves it to `upload_observed`. The
observed object MUST match the slot before the transition is applied:

- `objectKey` MUST equal the slot's `objectKey`;
- `contentType` MUST equal the slot's `contentType`;
- `size` MUST be at most `maxBytes` and, when `minBytes` is present, at
  least `minBytes`;
- `observedAt` MUST NOT be after `expiresAt` plus the configured late
  tolerance (Section 4.5.3);
- when the object carries `x-olos-slot-id` metadata, its value MUST
  equal the slot's `slotId`.

Observation by itself MUST NOT advance the cursor; only commit acceptance
does (Section 2.3).

## 4.5 Commit acceptance

### 4.5.1 Acceptance pipeline

<!-- olos-conformance: 4.5.1 CORE-SLOT-003 CORE-COMMIT-001 CORE-COMMIT-002 CORE-COMMIT-003 CORE-COMMIT-004 CORE-COMMIT-005 -->

A commit request names a `slotId`, a `commitId`, a `committedAt`
timestamp, the observed upload evidence, and optional `independent` and
`programDateTime` hints. The coordinator MUST evaluate, in order:

1. **Publication control.** If an application publication-control policy
   blocks committing, reject with `olos.security_policy_violation`
   (Section 10).
2. **Evidence match.** When the slot exists, the observed upload MUST
   match it: a mismatched `x-olos-slot-id` metadata value is rejected
   with `olos.invalid_state`; a content-type mismatch with
   `olos.content_type_mismatch`; a size above `maxBytes` with
   `olos.object_too_large`; a size below `minBytes` with
   `olos.object_too_small`.
3. **Duplicate resolution.** If the slot already has a commit, resolve
   per Section 4.5.2 and stop.
4. **Application commit policy.** An application-supplied commit policy
   MAY reject the candidate; the coordinator returns the policy's error
   unchanged.
5. **Slot lookup.** An unknown `slotId` is rejected with
   `olos.unknown_slot`.
6. **Session state.** A commit against an `aborted` session is rejected
   with `olos.invalid_state`.
7. **Object proof.** A commit without object proof (Section 4.4) MUST be
   rejected with `olos.invalid_state`; the slot stays uncommitted.
8. **Lateness against the cursor.** Per Section 4.5.3, rejected with
   `olos.invalid_state`.
9. **Key match.** An evidence `objectKey` differing from the slot's is
   rejected with `olos.key_mismatch`.
10. **Deadline.** `committedAt` MUST NOT be after the slot's `expiresAt`
    plus the configured late tolerance.

On acceptance the coordinator MUST atomically: move the slot to
`committed`, record the commit (init commits are tracked separately from
media commits), recompute the committed window (Section 05), advance the
cursor if the window advanced (Section 4.7), and apply retention
(Section 09). The accepted commit copies its positional and addressing
fields from the slot and its `size` and `etag` from the evidence
(Section 3.4).

### 4.5.2 Idempotency and duplicate conflicts

<!-- olos-conformance: 4.5.2 CORE-COMMIT-006 CORE-COMMIT-007 -->

Commits are idempotent per slot by evidence, not by `commitId`:

- When a slot already has an accepted commit and a second commit request
  arrives whose derived commit is identical on all of `deliveryUrl`,
  `duration`, `epoch`, `etag`, `independent`, `mediaSequenceNumber`,
  `objectKey`, `partNumber`, `programDateTime`, `renditionId`,
  `sessionId`, `size`, and `slotId`, the coordinator MUST return the
  existing commit as an idempotent success. It MUST NOT record a second
  commit, change any slot state, or move the cursor. `commitId` and
  `committedAt` are excluded from the comparison; a retried request MAY
  carry a fresh `commitId`.
- When any compared field differs, the coordinator MUST reject with
  `olos.duplicate_commit_conflict` and leave the existing commit intact.

### 4.5.3 Late commits

<!-- olos-conformance: 4.5.3 CORE-LATE-001 CORE-LATE-002 -->

Two independent lateness rules apply:

- **Slot deadline.** Both the observation time and `committedAt` MUST be
  at or before the slot's `expiresAt` plus a configured non-negative
  `lateToleranceMs` (default 0). A commit exactly at the tolerated
  deadline MUST be accepted; one beyond it MUST be rejected.
- **Cursor position.** When a cursor exists, a commit MUST be rejected
  with `olos.invalid_state` when its slot position is already behind the
  live edge: its MSN is less than the cursor's last MSN, or it is a part
  commit at the cursor's last MSN whose `partNumber` is less than or
  equal to the cursor's last part number. A full-segment commit at the
  cursor's last MSN MUST be accepted — it completes the in-progress
  segment.

## 4.6 Publisher leases and heartbeats

A publisher lease records one publisher instance's claim on a session so
competing publishers can detect an active holder. A lease carries
`sessionId`, `publisherInstanceId`, `issuedAt`, `lastSeenAt`, and
`expiresAt`, and MUST satisfy `issuedAt <= lastSeenAt <= expiresAt`.

- A heartbeat for a session with no lease for that
  `publisherInstanceId` creates one with `issuedAt = lastSeenAt = now`
  and `expiresAt = now + ttl`.
- A heartbeat that refreshes an existing lease MUST match the lease's
  `sessionId` and `publisherInstanceId`, MUST NOT carry a `now` earlier
  than `issuedAt`, and sets `lastSeenAt = now` and
  `expiresAt = now + ttl`.
- A lease is **active** while `now <= expiresAt` and **stale**
  afterwards; a stale lease MAY be taken over.
- Heartbeats MUST be rejected for sessions in a terminal state (`ended`
  or `aborted`).
- The coordinator keeps at most one lease per `publisherInstanceId` per
  session; a refresh replaces the previous lease record.

Lease TTL selection and publisher-loop guidance are runtime concerns
(Section 06, Section 09).

## 4.7 Cursor advancement

<!-- olos-conformance: 4.7 CORE-WINDOW-001 -->

The cursor is derived from the committed window: its `epoch` and MSN
bounds MUST equal the window's, and its `lastPartNumber`, when present,
MUST equal the window's last visible part number (Section 5.6). Cursor
positions are ordered by the triple (`epoch`,
`window.lastMediaSequenceNumber`, `window.lastPartNumber`), compared in
that order; an absent `lastPartNumber` orders before part number 0 at the
same MSN.

Given a current cursor and a candidate cursor:

- a candidate at a strictly greater position MUST replace the current
  cursor;
- a candidate at the same position whose committed window differs in any
  observable way MUST replace the current cursor (the window grew
  without moving the live edge, e.g. a full segment completing existing
  parts);
- a candidate identical in position and window MUST be treated as
  idempotent, keeping the current cursor;
- a candidate at a strictly lesser position is a regression and MUST NOT
  replace the current cursor; a direct cursor update reports
  `olos.cursor_regression`, while commit processing simply retains the
  current cursor.

The cursor MUST only change as a result of commit acceptance
(Section 4.5) or a session state transition (Section 4.1); in particular
observation alone never advances it (Section 4.4), and a commit recorded
at a not-yet-contiguous position leaves it unchanged (Section 5.3).

## 4.8 Revocation

<!-- olos-conformance: 4.8 CORE-SLOT-007 -->

Revocation withdraws a slot — and any commit it produced — before the
object becomes viewer-visible.

- Revoking an unknown `slotId` MUST be rejected with
  `olos.unknown_slot`.
- A slot whose object is referenced by the live cursor's committed
  window (as an init object, a segment, or a part) MUST NOT be revoked;
  such an attempt MUST be rejected with `olos.invalid_state`. Announced
  media can only leave the window through retention (Section 09) or a
  discontinuity, never silently.
- Otherwise a slot in state `issued`, `upload_observed`, or `committed`
  MAY be revoked; revocation removes any commits recorded for the slot
  from coordinator state.
- Revoking an already-`revoked` slot is idempotent.

## 4.9 Retention

On every cursor advance the coordinator applies retention: commits whose
objects have fallen behind the retained committed window and issued slots
past their expiry are pruned from state, and the pruned objects are
surfaced for storage deletion. Retention planning, deletion, and
reconciliation are specified in Section 09.
