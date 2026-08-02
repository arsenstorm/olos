---
"@arsenstorm/olos": minor
---

Schema and runtime validation are now aligned:

- Timestamps must be RFC 3339 date-time strings, which matches the schemas'
  `format: "date-time"`. Before this change, the runtime validators
  accepted any `Date.parse`-able string, such as `"2026-01-01"` or
  `"Jan 1 2026"`.
- `uploadSlot.maxBytes`, `commit.size`, and `mediaObject.size` must be
  positive integers on both the schema side and the validator side. Before
  this change, fractional values passed.
- `createObservedUploadFromHeadObject` normalizes string `lastModified`
  values (for example an HTTP `Last-Modified` header) to RFC 3339 before
  validation, so lenient provider timestamps keep working under the
  stricter rules. Unparseable values throw
  `lastModified must be a valid timestamp`.
- Persisted 0.5 snapshots that contain lenient timestamps or fractional
  sizes (only possible if a client supplied them) fail validation on the
  next read; there is no compatibility shim. Internally generated
  timestamps were always RFC 3339 and are unaffected.
- Every wire-document validator is now closed, matching the schemas'
  `additionalProperties: false`: `assertMediaObject`, `assertUploadGrant`,
  `assertProviderCapabilityDocument` (top level and every sub-object),
  `assertCommittedWindow` (window, rendition windows, segments, committed
  objects, and parts), and the nested `byterange` object all reject unknown
  properties. This breaks producers that attached extra fields to these
  documents; `assertCommit`, `assertUploadSlot`, `assertCursor`, and
  `assertSession` were already closed.
- Timestamps are strict in BOTH directions. The validators reject leap
  seconds, hour 24, space separators, colon-less offsets, and impossible
  calendar dates (for example `2026-02-30`); the schemas' timestamp fields
  carry a matching `pattern` (`RFC3339_TIMESTAMP_SCHEMA_PATTERN`) so
  schema-only validators reject the same strings — except impossible
  calendar dates, which need a format-aware validator (ajv-formats in full
  mode) or the runtime validators. `uploadCompletionHint.eventTime` is
  strict too; normalize provider formats (HTTP dates) before building the
  hint.
- Wire integers (`size`, `maxBytes`, sequence numbers, and other integer
  fields) must be JavaScript-safe integers; values at or above `2 ** 53`
  are rejected by the validators even though JSON Schema accepts them.
- `assertCursor` enforces spec §3.8: a present `cursor.window.lastPartNumber`
  must equal the committed window's last visible part number.
- NON-breaking, per spec §11.2 (consumers must ignore unknown fields): the
  runtime and S3 HTTP clients now prune unknown fields from response
  payloads (slots, grants, commits, cursors, retention and reconciliation
  bodies) before validating, so talking to a newer coordinator keeps
  working. The tolerant read-path parsers are exported from
  `olos/validation` as `parseCursor`, `parseCommit`, `parseUploadSlot`,
  and `parseUploadGrant`; each returns a pruned copy validated by the
  unchanged closed assert. Server-side request parsing stays closed.
- The schema drift suites now cover all 9 exported OLOS JSON schemas with
  `ajv-formats` format validation on. They also test validator-only
  payloads for constraints that JSON Schema cannot express, for example
  `minBytes <= maxBytes`, unsafe integers, and the cursor
  `lastPartNumber` cross-check, plus unknown-field exemplars at top level
  and nested levels.
