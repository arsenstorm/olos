---
"@arsenstorm/olos": minor
---

Retention pruning can now persist outside the commit path. The new
`applyCoordinatorRetention` (olos/protocol) prunes expired issued slots and
out-of-window commits through the same core that the commit path uses. The
new `applyStoredCoordinatorRetention` (olos/runtime) saves the pruned state
back through the coordinator store. If nothing changed, it does not save.
The S3 retention route now persists the pruned state before it deletes
remote objects, so a failed delete no longer loses the plan.
`deleteRetiredCoordinatorObjects` and `deleteRetiredS3CoordinatorObjects`
gain an opt-in `concurrency` option (default 1). The option bounds parallel
deletes and preserves result order.
