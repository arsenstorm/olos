# 9. Retention and reconciliation

Retention keeps persisted coordinator state and stored media bounded
by the live window. Reconciliation recovers uploads whose completion
signals were lost. The normative reference is
`olos/src/runtime/retention.ts`, `olos/src/s3/retention.ts`, and
`olos/src/s3/reconciliation.ts`.

## 9.1 Retention model

A retention pass over a session's state identifies:

- **Expired slots**: issued slots whose `expiresAt` is at or before
  the evaluation time and that never produced a commit.
- **Retired objects**: committed objects whose media sequence number
  has fallen strictly behind the retained window's first media
  sequence number (`msn < retainedWindow.firstMediaSequenceNumber`).
  Out-of-order commits *ahead* of the contiguous prefix MUST NOT be
  retired: a future part that has not yet become visible is live
  state, not garbage (see Section 5).

Retention never moves the cursor: pruning changes what is stored, not
what is published.

## 9.2 Planning vs application

<!-- olos-conformance: 9.2 CORE-RUNTIME-006 -->

The protocol separates read-only **planning** from state-mutating
**application**:

- **Plan** (`GET /sessions/:id/retention`, Section 6.4.5): computes
  `{ expiredSlots, retiredObjects, cursor? }` from the stored snapshot
  and the evaluation time (`now` query parameter or server clock). It
  MUST NOT write. Deployments use it to drive app-owned deletion jobs.
- **Apply** (`applyCoordinatorRetention`; the mutation behind the S3
  retention route): prunes expired slots from `state.slots` and
  retires commits behind the window from `state.commits`, then
  persists the pruned state under optimistic concurrency
  (Section 6.8). When the pass finds nothing to prune, the save MUST
  be skipped entirely so periodic sweeps do not churn etags or create
  spurious conflicts. The applied plan mirrors the planning shape with
  the (unchanged) cursor attached.

Commits themselves also apply inline retention (Section 5): each
successful commit prunes slots and commits that fell behind the
window and reports the pruned objects as `retiredObjects` for
deletion. The dedicated retention routes exist as a sweeper for state
that commits alone do not bound (idle sessions, sessions committed
without `maxSegments`, ended sessions).

## 9.3 S3 retention route ordering

`POST /sessions/:id/s3/retention` (Section 6.6.6) combines application
with storage deletion, and the ordering is normative:

1. Apply retention and **persist the pruned coordinator state**.
2. Only then delete the retired objects from the object store.
3. Respond `202` with `{ plan, result, summary }`, where `result`
   lists `deletedObjects` and `failedObjects` and `summary` counts
   them (`ok` is `true` iff nothing failed).

State MUST be persisted before any delete is attempted. Rationale: a
delete failure then cannot lose the plan — deletes are idempotent
against already-missing objects and can be retried by the next sweep,
while deleting first and failing to persist would leave an unpruned
snapshot that keeps growing and re-plans deletes for objects that no
longer exist. If the persist step conflicts, the route MUST respond
`409` without deleting anything.

Deletion requirements:

- **Idempotency.** Deleting an object that is already gone MUST be
  treated as success (S3 `DeleteObject` semantics). Every retired
  object may be deleted more than once across sweeps.
- **Failure isolation.** A failed delete MUST NOT abort the remaining
  deletes; failures are reported per object in `result.failedObjects`
  and retried by later sweeps.
- **Bounded concurrency** is an implementation option, not a protocol
  requirement: implementations MAY delete with a bounded worker pool
  (the reference default is sequential) and MUST keep result ordering
  stable by input position regardless of completion order.
- Object keys MUST be re-validated as safe keys (Section 7.5) before
  issuing deletes.

The same delete requirements apply to the inline `retiredObjects`
cleanup performed by S3 commit, completion-hint, event, and
reconciliation handlers. Implementations MAY defer those deletes until
after the response is sent (e.g. via a `waitUntil`-style scheduler);
deferral MUST NOT reorder the persist-before-delete rule, because the
pruned state was already persisted by the commit itself.

## 9.4 Reconciliation after missed events

Provider events and completion hints are best-effort. Reconciliation
is the recovery path that makes them optional for correctness: it
re-drives the verify-then-commit flow (Section 7.9) from the stored
slot table.

### 9.4.1 Plan — `POST /sessions/:id/s3/reconcile-plan`

Request: `{ "slotIds"?: [ ... ] }`. The plan selects the session's
slots in state `issued` or `upload_observed` — the in-flight slots
that might have a finished upload nobody reported — optionally
filtered to the requested `slotIds`. Response (`200`):

```json
{ "status": "planned", "slotIds": ["slot_7", "slot_8"], "slots": [ ... ] }
```

Planning MUST NOT mutate state and MUST NOT touch the object store.
Unknown sessions are `404 olos.invalid_session`.

### 9.4.2 Reconcile — `POST /sessions/:id/s3/reconcile`

Request fields: `committedAt` (REQUIRED), `providerId` (REQUIRED
unless configured server-side), plus optional `slotIds`, `versionId`,
`independent`, `lateToleranceMs`, `maxSegments`, `programDateTime`.

For each planned slot, in order, the coordinator attempts the standard
S3 commit: `HeadObject` the slot's derived key, validate against the
slot, commit. The commit id defaults to `reconcile_<slotId>` when the
deployment supplies none. Response (`202`):

- `results[]`: per slot, either
  `{ "status": "committed" | "idempotent", "slotId", "commit",
  "cursor"? }` or `{ "status": "failed", "slotId", "error"?,
  "resultStatus"? }`, where a rejection's `error` carries a registered
  error code (Section 6.3.1).
- `summary`: `{ planned, committed, idempotent, failed, ok, slotIds,
  failedSlotIds, failedErrorCodes, status }` with `ok` true iff no
  slot failed.

### 9.4.3 Recovery semantics and idempotency

- A slot whose object was never uploaded fails observation (the
  provider returns not-found) and is reported `failed`; the slot
  remains in-flight for future reconciliation or expiry.
- A slot whose upload was already committed through another path MUST
  resolve `idempotent`, not conflict: reconciliation uses the same
  duplicate-commit resolution as every other commit path (Section 4).
  Running reconciliation any number of times, interleaved with events
  and hints, MUST converge on exactly one commit per upload.
- Per-slot failures MUST NOT stop the run; every planned slot gets a
  result entry.
- Successful reconciliation commits advance the cursor and wake
  blocking reloads exactly like commit-route commits, and their
  retired objects are deleted per Section 9.3.
- Late uploads discovered by reconciliation are subject to the same
  late-commit rules and tolerances as any other commit (Section 4);
  reconciliation confers no immunity from window progression.

Deployments SHOULD run reconciliation on publisher restart and on an
interval commensurate with slot TTLs, and MAY scope it with `slotIds`
when recovering a specific transfer.
