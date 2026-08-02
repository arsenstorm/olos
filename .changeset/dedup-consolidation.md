---
"@arsenstorm/olos": minor
---

Dedup and consolidation pass:

- `S3RuntimeHttpError` now extends `RuntimeHttpError`, so
  `error instanceof RuntimeHttpError` also matches S3 client errors. Both
  exported names are unchanged.
- `S3RuntimeHttpClientOptions` is now a type alias of
  `RuntimeHttpClientOptions`. `S3RuntimeCompleteUploadResponse` is now a
  type alias of `S3RuntimeCommitUploadResponse`. Both pairs were
  structurally identical before, and the exported names are unchanged.
- BREAKING: `waitForHlsBlockingReload` no longer accepts the `clock`
  option, which duplicated `now`. Pass `now: () => number` instead.
- BREAKING: the object-key layout for nonce-bearing segments changed.
  Segment filenames are now always position-keyed and flat under the
  rendition directory:
  - segment without nonce: `<prefix>/<rid>/s<msn>.<ext>` (unchanged)
  - segment with nonce: `<prefix>/<rid>/s<msn>-<nonce>.<ext>`
    (before: `<prefix>/<rid>/s<msn>/segment-<nonce>.<ext>`)
  - part: `<prefix>/<rid>/s<msn>/p<n>[-<nonce>].<ext>` (unchanged)
  - init: `<prefix>/<rid>/init[-<nonce>].<ext>` (unchanged)
  Objects stored under the old form are not re-derived. Keys derive at slot
  issuance, so new sessions get the new layout automatically. To migrate an
  existing archive, re-derive the stored keys with
  `createPublisherObjectKey`. Sessions live across the deploy are a hazard:
  a virtual segment whose part slots were issued under both layouts derives
  two different `byterange.segmentObjectKey` aggregate addresses, so the
  byterange service can serve a truncated segment. Drain or restart live
  sessions around the upgrade. External tooling keyed to the old directory
  layout (bucket lifecycle rules, CDN path rules) also needs updating.
- Internal consolidation (shared path, timestamp, and error-message
  helpers, the S3 client payload parser collapse, facade-import cleanup,
  and stored coordinator mutation type-threading) keeps behavior the same.
