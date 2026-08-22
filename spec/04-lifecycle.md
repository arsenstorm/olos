# 4. Lifecycle

This section defines the normative state machine that turns uploads into
stream state. It covers session states, slot issuance, upload observation,
commit acceptance, publisher leases, and cursor advancement.

## 4.1 Session states

A session is in exactly one of four states:

| State     | Meaning                                                    |
| --------- | ---------------------------------------------------------- |
| `live`    | Accepts slots, uploads, and commits.                       |
| `ending`  | No longer the target of new objects.                       |
| `ended`   | Terminal. The stream completed normally.                   |
| `aborted` | Terminal. The stream was canceled.                         |

The only permitted transitions are:

- `live` -> `ending`
- `live` -> `aborted`
- `ending` -> `ended`

An implementation MUST reject any other transition, including transitions
out of `ended` or `aborted` and self-transitions. When a session
transitions, the implementation MUST update an existing cursor's `state`
field to the new session state in the same operation.

The coordinator MUST reject a commit against an `aborted` session with
`olos.invalid_state` (Section 4.5). For a session in a terminal state
(`ended` or `aborted`), the coordinator MUST reject publisher heartbeats
(Section 4.6).

## 4.2 Slot issuance

<!-- olos-conformance: 4.2 CORE-SLOT-001 CORE-SLOT-002 CORE-SLOT-006 -->

A slot is the only way to reserve a position in a session's timeline.

- Unless the session state is `live`, the coordinator MUST NOT issue a
  slot.
- `trackId` MUST name a track declared by the session. The coordinator
  MUST reject issuance for any other track.
- `slotId` MUST be unique among the slots the coordinator retains for
  the session. The coordinator MUST reject a duplicate `slotId`.
  Retention (Section 9) can prune a slot and free its identifier. A
  reissued identifier of a pruned slot can bind a stale in-flight
  upload to a new position, so publishers SHOULD use identifiers that
  never repeat.
- The coordinator MUST reject a slot for a position (`trackId`, `kind`,
  `sequenceNumber`, `partNumber`) that an open slot already occupies. A
  slot is open in state `issued`, `upload_observed`, or `committed`.
- The issued slot MUST carry the session's `sessionId` and `epoch`. The
  coordinator MUST create it in state `issued`.
- The coordinator derives `objectKey` from the slot's kind and position,
  under the object key layout of Section 7.5. A file extension is
  OPTIONAL in Core. A profile MAY require a specific extension
  (Section 8.9.5). To derive `deliveryUrl`, the coordinator appends the
  object key to the session's delivery base URL.
- In the direct-public publication mode, if the caller supplies no
  `objectKeyNonce`, the coordinator MUST generate a cryptographically
  random nonce. The nonce makes object keys unguessable (Section 10).
- `expiresAt`, `contentType`, `maxBytes`, and optional `minBytes`,
  `partNumber`, `byterange`, and `profile` are fixed at issuance and
  MUST NOT change for the lifetime of the slot. `byterange` is only valid
  on `part`-kind slots (Section 3.3.1).
- The slot's `profile` is the issuer's expectation of the object's
  profile-defined facts, for example a planned duration. This field is the
  base that the commit's `profile` merges over (Section 4.5.1).

Section 7 covers upload grants for issued slots.

## 4.3 Slot states and expiry

<!-- olos-conformance: 4.3 CORE-SLOT-004 CORE-SLOT-005 -->

A slot moves through the following states. The coordinator MUST reject any
transition not listed:

| From              | Permitted transitions                          |
| ----------------- | ---------------------------------------------- |
| `issued`          | `upload_observed`, `expired`, `revoked`        |
| `upload_observed` | `committed`, `rejected`, `revoked`             |
| `committed`       | `revoked`                                      |
| `expired`         | (terminal)                                     |
| `rejected`        | (terminal)                                     |
| `revoked`         | (terminal)                                     |

Rules:

- **Expiry.** The coordinator MAY move an `issued` slot to `expired`
  only at or after its `expiresAt` deadline. The coordinator MUST reject
  an attempt to expire a slot before its deadline. Expiry of an
  already-`expired` slot is idempotent.
- **Rejection.** Only an `upload_observed` slot moves to `rejected`
  (the observed object was refused). Rejection of an already-`rejected`
  slot is idempotent.
- **Revocation.** Section 4.8 defines the rules. Revocation of an
  already-`revoked` slot is idempotent.
- Idempotent re-application of a terminal transition MUST NOT alter the
  slot or any other state.

## 4.4 Upload observation

<!-- olos-conformance: 4.4 CORE-EVENT-001 CORE-EVENT-002 CORE-EVENT-003 CORE-EVENT-004 CORE-EVENT-005 -->

The coordinator learns that an object exists through one of three paths:

1. **Storage read.** A direct read of object metadata, for example
   `HeadObject` on S3-compatible stores (Appendix C). The coordinator
   normalizes the read into an observed upload. Its `observedAt` is the
   store-recorded creation or modification time when the store reports
   one. Otherwise it is the caller-supplied timestamp (the commit's
   `committedAt`, an event's observation time, or a hint's event time).
   Otherwise it is the coordinator clock (Section 7.3).
2. **Provider event.** An `object.created` event delivered by the
   storage provider. The event carries an `eventId`, an event time, and
   the object's key, content type, size, and optional etag and metadata.
3. **Completion hint.** An `upload.completed` hint posted by the
   publisher. The hint carries an `eventId`, an event time, an
   `objectKey`, and a `slotId`.

Precedence and proof:

- Paths 1 and 2 are **object proof**. A completion hint is not proof. On
  a hint alone, the coordinator MUST keep the slot uncommitted and await
  object proof.
- When both a hint and object proof are present, they MUST agree on
  `objectKey`. On a disagreement, the coordinator MUST reject with
  `olos.key_mismatch`.
- The coordinator MUST treat a redelivered `object.created` event as an
  idempotent duplicate with no further effect. The coordinator
  deduplicates by the slot's commit state (Section 4.5.2, Section 7.4).
  The `eventId` is informational.
- When an `object.created` event's object key matches no known slot, the
  coordinator MUST reject it with `olos.unknown_slot`.
- The coordinator MUST reject events of an unsupported type or with
  malformed payloads.

Observation applies to a slot in state `issued` or `upload_observed`
(idempotent for `upload_observed`) and moves it to `upload_observed`. The
observed object MUST match the slot before the coordinator applies the
transition:

- `objectKey` MUST equal the slot's `objectKey`.
- `contentType` MUST equal the slot's `contentType`.
- `size` MUST be at most `maxBytes`. When `minBytes` is present, `size`
  MUST be at least `minBytes`.
- `observedAt` MUST NOT be after `expiresAt` plus the configured late
  tolerance (`olos.slot_expired`, Section 4.5.3).
- When the object carries `x-olos-slot-id` metadata, its value MUST
  equal the slot's `slotId`.

Observation by itself MUST NOT advance the cursor. Only commit acceptance
advances it (Section 2.3).

## 4.5 Commit acceptance

### 4.5.1 Acceptance pipeline

<!-- olos-conformance: 4.5.1 CORE-SLOT-003 CORE-COMMIT-001 CORE-COMMIT-002 CORE-COMMIT-003 CORE-COMMIT-004 CORE-COMMIT-005 -->

A commit request names a `slotId`, a `commitId`, a `committedAt`
timestamp, and the observed upload evidence. An optional `profile` object
carries profile-defined facts about the object. The coordinator MUST
evaluate, in order:

1. **Publication control.** If an application publication-control policy
   blocks the commit, the coordinator rejects with
   `olos.security_policy_violation` (Section 10).
2. **Evidence match.** When the slot exists, the observed upload MUST
   match it (Section 4.4). Rejection codes:
   - `olos.invalid_state` for an `x-olos-slot-id` metadata mismatch
   - `olos.content_type_mismatch` for a content-type mismatch
   - `olos.object_too_large` for a size above `maxBytes`
   - `olos.object_too_small` for a size below `minBytes`
3. **Duplicate resolution.** If the slot already has a commit, the
   coordinator resolves it under Section 4.5.2 and stops.
4. **Application commit policy.** An application-supplied commit policy
   MAY reject the candidate. The coordinator returns the policy's error
   unchanged.
5. **Slot lookup.** The coordinator rejects an unknown `slotId` with
   `olos.unknown_slot`.
6. **Session state.** The coordinator rejects a commit against an
   `aborted` session with `olos.invalid_state`.
7. **Object proof.** Without object proof (Section 4.4), the coordinator
   MUST reject the commit with `olos.invalid_state`. The slot stays
   uncommitted. On the Core commit route (Section 6.5.2) the request's
   `object` field is the proof.
8. **Lateness against the cursor.** The coordinator rejects a commit
   behind the live edge with `olos.invalid_state` (Section 4.5.3).
9. **Key match.** When an evidence `objectKey` differs from the slot's
   key, the coordinator rejects with `olos.key_mismatch`.
10. **Deadline.** `committedAt` MUST NOT be after the slot's `expiresAt`
    plus the configured late tolerance. The coordinator rejects a later
    value with `olos.slot_expired`.

On acceptance the coordinator MUST do all of the following in one atomic
operation:

- move the slot to `committed`
- record the commit (the coordinator tracks init commits separately from
  segment and part commits)
- recompute the committed window (Section 5)
- if the window advanced, advance the cursor (Section 4.7)
- if the cursor advanced, apply retention (Section 9)

The accepted commit copies its positional and addressing fields from the
slot and its `size` and `etag` from the evidence (Section 3.4). The
commit's `profile` is the slot's `profile` merged with the request's
`profile`. The request value wins per top-level key. When the merge
yields no keys, the coordinator omits the field. A slot or request
`profile` of `{}` therefore contributes nothing. Core does not interpret
the merged object. The coordinator copies it unchanged onto the committed
object in the window (Section 5).

An init commit alone makes nothing visible. Core does not require an init
object per track. A profile MAY require one (the CMAF/LL-HLS profile
does, Section 8).

### 4.5.2 Idempotency and duplicate conflicts

<!-- olos-conformance: 4.5.2 CORE-COMMIT-006 CORE-COMMIT-007 -->

Commits are idempotent per slot.

- When a slot already has an accepted commit, the coordinator compares a
  second commit request with the existing commit. The comparison covers
  `deliveryUrl`, `epoch`, `etag`, `objectKey`, `partNumber`, `profile`,
  `sequenceNumber`, `sessionId`, `size`, `slotId`, and `trackId`. The
  coordinator compares `profile` structurally, under JSON semantics. Key
  order is irrelevant, arrays are ordered, and an absent object equals an
  `undefined` one.

  If the derived commit is identical on all of these fields, the
  coordinator MUST return the existing commit as an idempotent success.
  It MUST NOT record a second commit, change any slot state, or move the
  cursor. The comparison excludes `commitId` and `committedAt`. A retried
  request MAY carry a fresh `commitId`.
- When any compared field differs, the coordinator MUST reject with
  `olos.duplicate_commit_conflict` and leave the existing commit intact.

### 4.5.3 Late commits

<!-- olos-conformance: 4.5.3 CORE-LATE-001 CORE-LATE-002 -->

Two independent lateness rules apply:

- **Slot deadline.** Both the observation time and `committedAt` MUST be
  at or before the slot's `expiresAt` plus a configured non-negative
  `lateToleranceMs` (default 0). The coordinator MUST accept a commit
  exactly at the tolerated deadline. It MUST reject a commit beyond that
  deadline with `olos.slot_expired`.
- **Cursor position.** If a cursor exists and a commit's slot position is
  behind its own track's live edge, the coordinator MUST reject the
  commit with `olos.invalid_state`. A track's live edge is its last
  visible segment in the cursor's committed window. When that segment is
  parts-only, the live edge is its last visible part. A track absent from
  the committed window has no live edge and is never late.

  When a position's sequence number is less than the track's last
  sequence number, the position is behind the live edge. At the track's
  last sequence number, a part commit whose `partNumber` is at most the
  track's last part number is also behind. The coordinator MUST accept a
  full-segment commit at the track's last sequence number. That commit
  completes the in-progress segment.

## 4.6 Publisher leases and heartbeats

A publisher lease records one publisher instance's claim on a session so
competing publishers can detect an active holder. A lease carries
`sessionId`, `publisherInstanceId`, `issuedAt`, `lastSeenAt`, and
`expiresAt`, and MUST satisfy `issuedAt <= lastSeenAt <= expiresAt`.

- A heartbeat for a session with no lease for that
  `publisherInstanceId` creates one with `issuedAt = lastSeenAt = now`
  and `expiresAt = now + ttl`.
- A heartbeat that refreshes an existing lease MUST match the lease's
  `sessionId` and `publisherInstanceId`. It MUST NOT carry a `now`
  earlier than `issuedAt`. The refresh sets `lastSeenAt = now` and
  `expiresAt = now + ttl`.
- A lease is **active** while `now <= expiresAt` and **stale**
  afterwards. Another publisher MAY claim a stale lease.
- If a session is in a terminal state (`ended` or `aborted`), the
  coordinator MUST reject heartbeats.
- The coordinator keeps at most one lease per `publisherInstanceId` per
  session. A refresh replaces the previous lease record.

Lease TTL selection and publisher-loop guidance are runtime concerns
(Section 6, Section 9).

## 4.7 Cursor advancement

<!-- olos-conformance: 4.7 CORE-WINDOW-001 -->

The coordinator derives the cursor from the committed window. Its `epoch`
and sequence number bounds MUST equal the window's bounds. When present,
its `lastPartNumber` MUST equal the window's last visible part number
(Section 5.6). Cursor positions are ordered by the triple (`epoch`,
`window.lastSequenceNumber`, `window.lastPartNumber`), compared in that
order. An absent `lastPartNumber` orders before part number 0 at the
same sequence number.

The cursor's `profile` MUST be a copy of `session.profile`, unchanged
(Section 2.1). The window build MAY take a track-window `profile` hook
supplied by the profile (Section 5.7).

Given a current cursor and a candidate cursor:

- A candidate at a strictly greater position MUST replace the current
  cursor.
- A candidate at the same position whose committed window differs in any
  observable way MUST replace the current cursor. One such case is a
  window that grew while the live edge did not move, for example a full
  segment that completes existing parts.
- The coordinator MUST treat a candidate identical in position and
  window as idempotent. The coordinator keeps the current cursor.
- A candidate at a strictly lesser position is a regression and MUST NOT
  replace the current cursor. A direct cursor update reports
  `olos.cursor_regression`. During commit processing, the coordinator
  keeps the current cursor.

The cursor MUST only change on commit acceptance (Section 4.5) or on a
session state transition (Section 4.1). Observation alone never advances
it (Section 4.4). A commit recorded at a not-yet-contiguous position
leaves it unchanged (Section 5.3).

## 4.8 Revocation

<!-- olos-conformance: 4.8 CORE-SLOT-007 -->

Revocation withdraws a slot, and any commit it produced, before the
object becomes viewer-visible.

- When the `slotId` is unknown, the coordinator MUST reject the
  revocation with `olos.unknown_slot`.
- The coordinator MUST NOT revoke a slot whose object appears in the live
  cursor's committed window (as an init object, a segment, or a part).
  The coordinator MUST reject such an attempt with `olos.invalid_state`.
  Announced objects can leave the window only through retention
  (Section 9). They never leave silently.
- Otherwise the coordinator MAY revoke a slot in state `issued`,
  `upload_observed`, or `committed`. Revocation deletes any commits
  recorded for the slot from coordinator state.
- Revocation of an already-`revoked` slot is idempotent.

## 4.9 Retention

On every cursor advance the coordinator applies retention. Section 9
specifies retention planning, deletion, and reconciliation.
