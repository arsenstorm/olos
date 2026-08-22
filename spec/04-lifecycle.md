# 4. Lifecycle

This section defines the normative state machine that turns uploads into
stream state. It covers session states, slot issuance, upload observation,
commit acceptance, publisher leases, and cursor advancement.

## 4.1 Session states

A session is in exactly one of four states:

| State     | Meaning                                                    |
| --------- | ---------------------------------------------------------- |
| `live`    | Accepts slots, uploads, and commits.                       |
| `ending`  | Winds down. No longer the target of new objects.           |
| `ended`   | Terminal. The stream completed normally.                   |
| `aborted` | Terminal. The stream was cancelled.                        |

The only permitted transitions are:

- `live` -> `ending`
- `live` -> `aborted`
- `ending` -> `ended`

An implementation MUST reject any other transition, including transitions
out of `ended` or `aborted` and self-transitions. When a session
transitions, the implementation MUST update an existing cursor's `state`
field to the new session state in the same operation.

Commits against an `aborted` session MUST be rejected with
`olos.invalid_state` (Section 4.5). Publisher heartbeats for sessions in a
terminal state (`ended` or `aborted`) MUST be rejected (Section 4.6).

## 4.2 Slot issuance

<!-- olos-conformance: 4.2 CORE-SLOT-001 CORE-SLOT-002 CORE-SLOT-006 -->

A slot is the only way to reserve a position in a session's timeline.

- The coordinator MUST NOT issue a slot unless the session state is
  `live`.
- `trackId` MUST name a track declared by the session. The coordinator
  MUST reject issuance for any other track.
- `slotId` MUST be unique among the slots the coordinator retains for
  the session. The coordinator MUST reject a duplicate `slotId`.
  Retention (Section 9) can prune a slot and free its identifier. A
  reissued identifier of a pruned slot can bind a stale in-flight
  upload to a new position, so publishers SHOULD use identifiers that
  never repeat.
- The issued slot MUST carry the session's `sessionId` and `epoch`. It
  MUST be created in state `issued`.
- The coordinator derives `objectKey` from the slot's kind and position:
  `objects/<trackId>/init[-<nonce>]`,
  `objects/<trackId>/s<seq>[-<nonce>]`, or
  `objects/<trackId>/s<seq>/p<part>[-<nonce>]`, where `<seq>` is the
  slot's `sequenceNumber` and `<part>` its `partNumber` (layout details
  in Section 7). A file extension is OPTIONAL in Core. When the issuer
  supplies one, the coordinator appends it after the nonce; a profile
  MAY require a specific extension (the CMAF/LL-HLS profile requires
  `.mp4` for init objects and `.m4s` for segments and parts,
  Section 8). To derive `deliveryUrl`, the coordinator appends the
  object key to the session's delivery base URL.
- In the direct-public publication mode, if the caller supplies no
  `objectKeyNonce`, the coordinator MUST generate a cryptographically
  random nonce (the reference implementation uses 128 bits). The nonce
  makes object keys unguessable (Section 10).
- `expiresAt`, `contentType`, `maxBytes`, and optional `minBytes`,
  `partNumber`, `byterange`, and `profile` are fixed at issuance and
  MUST NOT change for the lifetime of the slot. `byterange` is only valid
  on `part`-kind slots (Section 3.3.1).
- The slot's `profile` is the issuer's expectation of the object's
  profile-defined facts (for example a planned duration under the
  CMAF/LL-HLS profile). Core treats it as an opaque JSON object. It is
  the base that the commit's `profile` is merged over (Section 4.5.1).

Upload grants for issued slots are covered in Section 7.

## 4.3 Slot states and expiry

<!-- olos-conformance: 4.3 CORE-SLOT-004 CORE-SLOT-005 -->

A slot moves through the following states. Any transition not listed MUST
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
  its `expiresAt` deadline. An attempt to expire a slot before its
  deadline MUST be rejected. Expiry of an already-`expired` slot is
  idempotent.
- **Rejection.** Only an `upload_observed` slot can move to `rejected`
  (the observed object was refused). Rejection of an already-`rejected`
  slot is idempotent.
- **Revocation** is defined in Section 4.8. Revocation of an
  already-`revoked` slot is idempotent.
- Idempotent re-application of a terminal transition MUST NOT alter the
  slot or any other state.

## 4.4 Upload observation

<!-- olos-conformance: 4.4 CORE-EVENT-001 CORE-EVENT-002 CORE-EVENT-003 CORE-EVENT-004 CORE-EVENT-005 -->

The coordinator learns that an object exists through one of three paths:

1. **Storage read** — a direct read of object metadata (for
   S3-compatible stores, `HeadObject`, Section 7). The read is
   normalized into an observed upload. Its `observedAt` is the
   caller-supplied timestamp when one exists (the commit's
   `committedAt`, an event's observation time, or a hint's event time),
   else the object's last-modified time, else the coordinator clock
   (Section 7.3). The lateness rules of Section 4.5.3 therefore bound
   the supplied timestamp, not the storage upload time. A deployment
   that needs upload-time anchoring MUST NOT supply a timestamp.
2. **Provider event** — an `object.created` event delivered by the
   storage provider. The event carries an `eventId`, an event time, and
   the object's key, content type, size, and optional etag and metadata.
3. **Completion hint** — an `upload.completed` hint posted by the
   publisher. The hint carries an `eventId`, an event time, an
   `objectKey`, and a `slotId`.

Precedence and proof:

- Paths 1 and 2 are **object proof**. A completion hint is not proof. On
  a hint alone, the coordinator MUST keep the slot uncommitted and await
  object proof.
- When both a hint and object proof are present, they MUST agree on
  `objectKey`. A disagreement MUST be rejected with `olos.key_mismatch`.
- The coordinator MUST treat a redelivered `object.created` event as an
  idempotent duplicate with no further effect. Deduplication is by slot
  commit state, not by `eventId` (Section 4.5.2, Section 7.4). The
  `eventId` is informational.
- An `object.created` event whose object key matches no known slot MUST
  be rejected with `olos.unknown_slot`.
- Events of an unsupported type or with malformed payloads MUST be
  rejected.

Observation applies to a slot in state `issued` or `upload_observed`
(idempotent in the latter case) and moves it to `upload_observed`. The
observed object MUST match the slot before the transition is applied:

- `objectKey` MUST equal the slot's `objectKey`.
- `contentType` MUST equal the slot's `contentType`.
- `size` MUST be at most `maxBytes`. When `minBytes` is present, `size`
  MUST be at least `minBytes`.
- `observedAt` MUST NOT be after `expiresAt` plus the configured late
  tolerance (Section 4.5.3).
- When the object carries `x-olos-slot-id` metadata, its value MUST
  equal the slot's `slotId`.

Observation by itself MUST NOT advance the cursor. Only commit acceptance
advances it (Section 2.3).

## 4.5 Commit acceptance

### 4.5.1 Acceptance pipeline

<!-- olos-conformance: 4.5.1 CORE-SLOT-003 CORE-COMMIT-001 CORE-COMMIT-002 CORE-COMMIT-003 CORE-COMMIT-004 CORE-COMMIT-005 -->

A commit request names a `slotId`, a `commitId`, a `committedAt`
timestamp, the observed upload evidence, and an optional `profile`
object carrying profile-defined facts about the object. The coordinator
MUST evaluate, in order:

1. **Publication control.** If an application publication-control policy
   blocks the commit, reject with `olos.security_policy_violation`
   (Section 10).
2. **Evidence match.** When the slot exists, the observed upload MUST
   match it. A mismatched `x-olos-slot-id` metadata value is rejected
   with `olos.invalid_state`. A content-type mismatch is rejected with
   `olos.content_type_mismatch`. A size above `maxBytes` is rejected
   with `olos.object_too_large`. A size below `minBytes` is rejected
   with `olos.object_too_small`.
3. **Duplicate resolution.** If the slot already has a commit, resolve
   per Section 4.5.2 and stop.
4. **Application commit policy.** An application-supplied commit policy
   MAY reject the candidate. The coordinator returns the policy's error
   unchanged.
5. **Slot lookup.** An unknown `slotId` is rejected with
   `olos.unknown_slot`.
6. **Session state.** A commit against an `aborted` session is rejected
   with `olos.invalid_state`.
7. **Object proof.** A commit without object proof (Section 4.4) MUST be
   rejected with `olos.invalid_state`. The slot stays uncommitted.
8. **Lateness against the cursor.** A commit behind the live edge is
   rejected with `olos.invalid_state` (Section 4.5.3).
9. **Key match.** An evidence `objectKey` that differs from the slot's
   key is rejected with `olos.key_mismatch`.
10. **Deadline.** `committedAt` MUST NOT be after the slot's `expiresAt`
    plus the configured late tolerance.

On acceptance the coordinator MUST do all of the following in one atomic
operation:

- move the slot to `committed`
- record the commit (init commits are tracked separately from segment
  and part commits)
- recompute the committed window (Section 5)
- if the window advanced, advance the cursor (Section 4.7)
- apply retention (Section 9)

The accepted commit copies its positional and addressing fields from the
slot and its `size` and `etag` from the evidence (Section 3.4). The
commit's `profile` is the slot's `profile` merged with the request's
`profile`: the request value wins per top-level key, and the field is
omitted when the merge yields no keys. Core does not interpret the
merged object. It is copied unchanged onto the committed object in the
window (Section 5). An init commit alone makes nothing visible. Core
does not require an init object per track; a profile MAY require one
(the CMAF/LL-HLS profile does, Section 8).

### 4.5.2 Idempotency and duplicate conflicts

<!-- olos-conformance: 4.5.2 CORE-COMMIT-006 CORE-COMMIT-007 -->

Commits are idempotent per slot. The comparison uses evidence fields and
excludes `commitId`:

- When a slot already has an accepted commit, a second commit request is
  compared with the existing commit. The comparison covers `deliveryUrl`,
  `epoch`, `etag`, `objectKey`, `partNumber`, `profile`,
  `sequenceNumber`, `sessionId`, `size`, `slotId`, and `trackId`.
  `profile` is compared structurally (JSON semantics: key order is
  irrelevant, arrays are ordered, and an absent object equals an
  `undefined` one). If the derived commit is identical on all of these
  fields, the coordinator MUST return the existing commit as an
  idempotent success. It MUST NOT record a second commit, change any
  slot state, or move the cursor. `commitId` and `committedAt` are
  excluded from the comparison. A retried request MAY carry a fresh
  `commitId`.
- When any compared field differs, the coordinator MUST reject with
  `olos.duplicate_commit_conflict` and leave the existing commit intact.

### 4.5.3 Late commits

<!-- olos-conformance: 4.5.3 CORE-LATE-001 CORE-LATE-002 -->

Two independent lateness rules apply:

- **Slot deadline.** Both the observation time and `committedAt` MUST be
  at or before the slot's `expiresAt` plus a configured non-negative
  `lateToleranceMs` (default 0). A commit exactly at the tolerated
  deadline MUST be accepted. A commit beyond it MUST be rejected.
- **Cursor position.** When a cursor exists and a commit's slot position
  is already behind its own track's live edge within the cursor's
  committed window (the last visible segment, and its last visible part
  when that segment is parts-only), the commit MUST be rejected with
  `olos.invalid_state`. A track absent from the committed window has no
  live edge and is never late. The position is behind the live edge if
  its sequence number is less than the track's last sequence number. A
  part commit at the track's last sequence number is also behind if its
  `partNumber` is less than or equal to the track's last part number. A
  full-segment commit at the track's last sequence number MUST be
  accepted. It completes the in-progress segment.

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
  afterwards. A stale lease MAY be taken over.
- If a session is in a terminal state (`ended` or `aborted`), heartbeats
  MUST be rejected.
- The coordinator keeps at most one lease per `publisherInstanceId` per
  session. A refresh replaces the previous lease record.

Lease TTL selection and publisher-loop guidance are runtime concerns
(Section 6, Section 9).

## 4.7 Cursor advancement

<!-- olos-conformance: 4.7 CORE-WINDOW-001 -->

The cursor is derived from the committed window. Its `epoch` and
sequence number bounds MUST equal the window's bounds. When present, its
`lastPartNumber` MUST equal the window's last visible part number
(Section 5.6). Cursor positions are ordered by the triple (`epoch`,
`window.lastSequenceNumber`, `window.lastPartNumber`), compared in that
order. An absent `lastPartNumber` orders before part number 0 at the
same sequence number.

The cursor's `profile` MUST be a copy of `session.profile`, unchanged.
The window build MAY take a profile-supplied hook that produces each
track window's `profile` from that track's visible and trimmed segments
(Section 5.7). Core records whatever the hook returns without
interpreting it.

Given a current cursor and a candidate cursor:

- A candidate at a strictly greater position MUST replace the current
  cursor.
- A candidate at the same position whose committed window differs in any
  observable way MUST replace the current cursor. This occurs when the
  window grew but the live edge did not move, for example when a full
  segment completes existing parts.
- A candidate identical in position and window MUST be treated as
  idempotent. The current cursor is kept.
- A candidate at a strictly lesser position is a regression and MUST NOT
  replace the current cursor. A direct cursor update reports
  `olos.cursor_regression`. Commit processing retains the current
  cursor.

The cursor MUST only change as a result of commit acceptance
(Section 4.5) or a session state transition (Section 4.1). Observation
alone never advances it (Section 4.4). A commit recorded at a
not-yet-contiguous position leaves it unchanged (Section 5.3).

## 4.8 Revocation

<!-- olos-conformance: 4.8 CORE-SLOT-007 -->

Revocation withdraws a slot, and any commit it produced, before the
object becomes viewer-visible.

- Revoking an unknown `slotId` MUST be rejected with
  `olos.unknown_slot`.
- A slot whose object is referenced by the live cursor's committed
  window (as an init object, a segment, or a part) MUST NOT be revoked.
  Such an attempt MUST be rejected with `olos.invalid_state`. Announced
  objects can leave the window only through retention (Section 9). They
  never leave silently.
- Otherwise a slot in state `issued`, `upload_observed`, or `committed`
  MAY be revoked. Revocation deletes any commits recorded for the slot
  from coordinator state.
- Revocation of an already-`revoked` slot is idempotent.

## 4.9 Retention

On every cursor advance the coordinator applies retention. Commits whose
objects fell behind the retained committed window are pruned from state.
Issued slots past their expiry are also pruned. The pruned objects are
surfaced for storage deletion. Retention planning, deletion, and
reconciliation are specified in Section 9.
