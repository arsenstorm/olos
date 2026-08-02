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
- The schema drift suites now cover all 9 exported OLOS JSON schemas with
  `ajv-formats` format validation on. They also test validator-only
  payloads for constraints that JSON Schema cannot express, for example
  `minBytes <= maxBytes`.
