---
"@arsenstorm/olos": minor
---

All HTTP error responses now include the schema-required `error.code`
next to `error.message`. Every error body now conforms to
`OLOS_ERROR_SCHEMA`. Four new codes exist in `OLOS_ERROR_CODES`:
`olos.invalid_request`, `olos.not_found`, `olos.method_not_allowed`, and
`olos.conflict`. This change breaks consumers that match the previous
`{ error: { message } }` shape.
