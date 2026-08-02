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
- The schema drift suites now cover all 9 exported OLOS JSON schemas with
  `ajv-formats` format validation on. They also test validator-only
  payloads for constraints that JSON Schema cannot express, for example
  `minBytes <= maxBytes`.
