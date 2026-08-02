---
"@arsenstorm/olos": minor
---

Dedup and consolidation pass:

- `S3RuntimeHttpError` now extends `RuntimeHttpError`, so
  `error instanceof RuntimeHttpError` also matches S3 client errors
  (instanceof checks widen; both exported names are unchanged).
- `S3RuntimeHttpClientOptions` is now a type alias of
  `RuntimeHttpClientOptions`, and `S3RuntimeCompleteUploadResponse` an
  alias of `S3RuntimeCommitUploadResponse` (structurally identical
  before; exported names unchanged).
- BREAKING: `waitForHlsBlockingReload` no longer accepts the `clock`
  option — it duplicated `now`. Pass `now: () => number` instead.
- BREAKING: object-key layout unification for nonce-bearing segments.
  Segment filenames are now always position-keyed flat under the
  rendition directory:
  - segment without nonce: `<prefix>/<rid>/s<msn>.<ext>` (unchanged)
  - segment with nonce: `<prefix>/<rid>/s<msn>-<nonce>.<ext>`
    (previously `<prefix>/<rid>/s<msn>/segment-<nonce>.<ext>`)
  - part: `<prefix>/<rid>/s<msn>/p<n>[-<nonce>].<ext>` (unchanged)
  - init: `<prefix>/<rid>/init[-<nonce>].<ext>` (unchanged)
  Objects stored under the old nonce-only `s<msn>/segment-<nonce>.<ext>`
  form will not be re-derived: republish live sessions (keys are derived
  at slot issuance, so new sessions pick up the new layout automatically)
  or re-derive stored keys with `createPublisherObjectKey` when migrating
  existing archives.
- Internal consolidation (shared path/timestamp/error-message helpers,
  S3 client payload parser collapse, facade-import cleanup, stored
  coordinator mutation type-threading) is otherwise behavior-preserving.
