---
"@arsenstorm/olos": minor
---

Store and retention consistency fixes:

- `createSerializedCoordinatorStore` derives the next etag from the
  caller's `expectedEtag` instead of pre-loading the current record, so
  every save costs one backend round trip and cannot race a concurrent
  writer between load and save; the backend's atomic etag check still
  decides, and conflicts keep returning the winning record.
- The memory coordinator store's `loadCursor` clones the snapshot before
  projecting the view, so returned views never alias stored state.
- `assertCoordinatorPipelineStoreConformance` now exercises `loadCursor`
  when a store implements it: missing sessions resolve `undefined`, the
  view's etag and session match the loaded snapshot, no cursor is
  reported before a commit, and views must not alias each other or the
  stored state. Custom stores whose `loadCursor` aliases stored state
  will start failing the harness.
- Retention honors `lateToleranceMs` end to end: `selectExpiredUploadSlots`,
  `planCoordinatorRetention`, `applyCoordinatorRetention`, the stored
  plan/apply flows, the runtime retention route, and the S3 retention
  route all accept the option, and commit-time auto-retention reuses the
  commit's own tolerance — so a sweep can no longer prune a slot whose
  late upload would still commit.
- `uploadCompletionHint.eventTime` is validated as strict RFC 3339 instead
  of any `Date.parse`-able string (HTTP-date `Last-Modified` normalization
  stays lenient).
- The S3 runtime client now surfaces per-slot reconciliation failure
  details — the `error` envelope (`code`, `message`, optional `details`)
  and `resultStatus` the server already emitted — on failed results
  instead of dropping them.
