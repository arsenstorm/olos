---
"@arsenstorm/olos": minor
---

Retention pruning can now persist outside the commit path. The new
`applyCoordinatorRetention` (olos/protocol) prunes expired issued slots and
out-of-window commits through the same core that the commit path uses. The
new `applyStoredCoordinatorRetention` (olos/runtime) saves the pruned state
back through the coordinator store. If nothing changed, it does not save.
The S3 retention route now persists the pruned state before it deletes
remote objects, so a delete failure cannot leave an unpruned snapshot
growing. Known limit: a failed delete is not re-planned by later sweeps
(the pruned state no longer references the object). Failures surface in
the 202 response body for caller-driven retry; configure a bucket
lifecycle rule as the backstop for orphaned objects.
`deleteRetiredCoordinatorObjects` and `deleteRetiredS3CoordinatorObjects`
gain an opt-in `concurrency` option (default 1). The option bounds parallel
deletes and preserves result order.
