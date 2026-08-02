---
"@arsenstorm/olos": minor
---

Retention pruning can now be persisted outside the commit path: the new
`applyCoordinatorRetention` (olos/protocol) prunes expired issued slots and
out-of-window commits through the same core the commit path uses, and the new
`applyStoredCoordinatorRetention` (olos/runtime) saves the pruned state back
through the coordinator store, skipping the save when nothing changed. The S3
retention route now persists the pruned state before deleting remote objects,
so a failed delete no longer loses the plan. `deleteRetiredCoordinatorObjects`
and `deleteRetiredS3CoordinatorObjects` gain an opt-in `concurrency` option
(default 1) that bounds parallel deletes while preserving result order.
