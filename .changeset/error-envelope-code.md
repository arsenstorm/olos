---
"@arsenstorm/olos": minor
---

All HTTP error responses now include the schema-required `error.code` alongside `error.message`, so every error body conforms to `OLOS_ERROR_SCHEMA`. Four new codes were added to `OLOS_ERROR_CODES`: `olos.invalid_request`, `olos.not_found`, `olos.method_not_allowed`, and `olos.conflict`. This is breaking for consumers matching the previous `{ error: { message } }` shape.
