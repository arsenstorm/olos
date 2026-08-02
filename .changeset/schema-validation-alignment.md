---
"@arsenstorm/olos": minor
---

Schema and runtime validation are now aligned:

- Timestamps must be RFC 3339 date-time strings (matching the schemas'
  `format: "date-time"`); previously any `Date.parse`-able string such as
  `"2026-01-01"` or `"Jan 1 2026"` was accepted by the runtime validators.
- `uploadSlot.maxBytes`, `commit.size`, and `mediaObject.size` must be
  positive integers on both the schema and validator side (they were
  previously allowed to be fractional).
- The schema drift suites now cover all 9 exported OLOS JSON schemas with
  `ajv-formats` format validation enabled, plus validator-only payloads for
  constraints JSON Schema cannot express (e.g. `minBytes <= maxBytes`).
