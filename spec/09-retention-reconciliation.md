# 9. Retention and reconciliation

Retention keeps persisted coordinator state and stored objects bounded
by the live window. Reconciliation recovers uploads whose completion
signals were lost. The normative reference is
`olos/src/state/retention.ts`, `olos/src/protocol/coordinator-retention.ts`,
`olos/src/runtime/retention.ts`, `olos/src/s3/retention.ts`, and
`olos/src/s3/reconciliation.ts`.

## 9.1 Retention model

A retention pass over a session's state identifies:

- **Expired slots**: issued slots whose `expiresAt` (plus the configured
  late tolerance) is at or before the evaluation time and that never
  produced a commit.
- **Retired objects**: committed objects whose sequence number is
  strictly behind the first visible segment of their own track in the
  retained window (`sequenceNumber <
  retainedWindow.tracks[trackId].segments[0].sequenceNumber`) and whose
  slot does not back any object still in the window. The comparison is
  per track, like window trimming (Section 5.7): a window-global
  minimum would let one lagging track pin every other track's trimmed
  commits. A commit whose track is absent from the window is kept.
  Out-of-order commits *ahead* of the contiguous prefix MUST NOT be
  retired. A future part that is not yet visible is live state, not
  garbage (see Section 5).

Retention never moves the cursor. Pruning changes what is stored, not
what is published.

## 9.2 Planning vs application

<!-- olos-conformance: 9.2 CORE-RUNTIME-006 -->

The protocol separates read-only **planning** from state-mutating
**application**:

- **Plan** (`GET /sessions/:id/retention`, Section 6.4.5): computes
  `{ expiredSlots, retiredObjects, cursor? }` from the stored snapshot
  and the evaluation time (`now` query parameter or server clock). It
  MUST NOT write. Deployments use it to drive app-owned deletion jobs.
- **Apply** (`applyCoordinatorRetention`, the mutation behind the S3
  retention route): prunes expired slots from `state.slots` and
  retires commits behind the window from `state.commits`, then
  persists the pruned state under optimistic concurrency
  (Section 6.8). When the pass finds nothing to prune, the save MUST
  be skipped entirely. Periodic sweeps then do not churn etags or
  create spurious conflicts. The applied plan mirrors the planning
  shape with the (unchanged) cursor attached.

Commits themselves also apply inline retention (Section 5). Each
successful commit prunes slots and commits that fell behind the
window. It reports the pruned objects as `retiredObjects` for
deletion. The dedicated retention routes exist as a sweeper for state
that commits alone do not bound (idle sessions, sessions committed
without `maxSegments`, ended sessions).

## 9.3 S3 retention route ordering

`POST /sessions/:id/s3/retention` (Section 6.6.6) combines application
with storage deletion, and the ordering is normative:

1. Apply retention and **persist the pruned coordinator state**.
2. Only then delete the retired objects from the object store.
3. Respond `202` with `{ plan, result, summary }`. `result` lists
   `deletedObjects` and `failedObjects`. `summary` counts them (`ok`
   is `true` when, and only when, nothing failed).

State MUST be persisted before any delete is attempted. Rationale:
persisted state then never references already-deleted objects, so a
crash between delete and persist cannot resurrect such a reference. A
delete-first order that fails to persist leaves an unpruned snapshot.
That snapshot keeps growing and re-plans deletes for objects that no
longer exist. The trade-off: a failed delete is never re-planned,
because the pruned state no longer references the object. Failures
surface per object in `result.failedObjects` for the caller to retry
(deletes are idempotent). Bucket lifecycle rules are the backstop for
orphaned objects. If the persist step conflicts, the route MUST
respond `409` and delete nothing.

Deletion requirements:

- **Idempotency.** A delete of an object that is already gone MUST be
  treated as success (S3 `DeleteObject` semantics). A caller retry can
  therefore delete a retired object more than once safely.
- **Failure isolation.** A failed delete MUST NOT abort the remaining
  deletes. Failures are reported per object in `result.failedObjects`
  for the caller to retry. Later sweeps do not re-plan them.
- **Bounded concurrency** is an implementation option, not a protocol
  requirement. Implementations MAY delete with a bounded worker pool
  (the reference default is sequential). They MUST keep result
  ordering stable by input position regardless of completion order.
- Object keys MUST be re-validated as safe keys under the `objects/`
  prefix (Section 7.5) before the implementation issues deletes.

The same delete requirements apply to the inline `retiredObjects`
cleanup performed by S3 commit, completion-hint, event, and
reconciliation handlers. Implementations MAY defer those deletes until
after the response is sent (for example, with a `waitUntil`-style
scheduler). Deferral MUST NOT reorder the persist-before-delete rule,
because the commit itself already persisted the pruned state.

## 9.4 Reconciliation after missed events

Provider events and completion hints are best-effort. Reconciliation
is the recovery path that makes them optional for correctness. It
re-drives the verify-then-commit flow (Section 7.9) from the stored
slot table.

### 9.4.1 Plan — `POST /sessions/:id/s3/reconcile-plan`

Request: `{ "slotIds"?: [ ... ] }`. The plan selects the session's
slots in state `issued` or `upload_observed`. These are the in-flight
slots that can have a finished upload that no one reported. The plan
optionally filters them to the requested `slotIds`. Response (`200`):

```json
{ "status": "planned", "slotIds": ["slot_7", "slot_8"], "slots": [ ... ] }
```

Planning MUST NOT mutate state and MUST NOT touch the object store.
Unknown sessions are `404 olos.invalid_session`.

### 9.4.2 Reconcile — `POST /sessions/:id/s3/reconcile`

Request fields: `committedAt` (REQUIRED), `providerId` (REQUIRED
unless configured server-side), plus optional `slotIds`, `versionId`,
`lateToleranceMs`, `maxSegments`, and `profile` (profile-defined facts
recorded on each reconciled commit, merged over the slot's `profile`
as in Section 4.5.1).

For each planned slot, in order, the coordinator attempts the standard
S3 commit. It observes the slot's derived key with `HeadObject`, makes
sure that the object matches the slot, and commits. The commit id
defaults to `reconcile_<slotId>` when the deployment supplies none.
Response (`202`):

- `results[]`: per slot, either
  `{ "status": "committed" | "idempotent", "slotId", "commit",
  "cursor"? }` or `{ "status": "failed", "slotId", "error"?,
  "resultStatus"? }`, where a rejection's `error` carries a registered
  error code (Section 6.3.1).
- `summary`: `{ planned, committed, idempotent, failed, ok, slotIds,
  failedSlotIds, failedErrorCodes, status }`. `ok` is true when, and
  only when, no slot failed.

### 9.4.3 Recovery semantics and idempotency

- A slot whose object was never uploaded fails observation (the
  provider returns not-found) and is reported `failed`. The slot
  remains in-flight for future reconciliation or expiry.
- A slot whose upload was already committed through another path MUST
  resolve `idempotent`, not conflict. Reconciliation uses the same
  duplicate-commit resolution as every other commit path (Section 4).
  Any number of reconciliation runs, interleaved with events and
  hints, MUST converge on exactly one commit per upload.
- Per-slot failures MUST NOT stop the run. Every planned slot gets a
  result entry.
- Successful reconciliation commits advance the cursor and wake
  blocking reloads exactly like commit-route commits. Their retired
  objects are deleted as Section 9.3 defines.
- Late uploads discovered by reconciliation are subject to the same
  late-commit rules and tolerances as any other commit (Section 4).
  Reconciliation gives no immunity from window progression.

Deployments SHOULD run reconciliation on publisher restart and on an
interval that matches slot TTLs. They MAY scope it with `slotIds` when
they recover a specific transfer.
