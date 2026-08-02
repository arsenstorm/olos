---
"@arsenstorm/olos": minor
---

Malformed `transitionStoredCoordinatorSession` and
`heartbeatStoredCoordinatorPublisher` options (bad `sessionId`,
`publisherInstanceId`, `now`, `ttlMs`, or an unknown state) now reject with
400 `olos.invalid_request` instead of 409 `olos.invalid_state`, matching
the spec's status mapping. State-machine rejections (illegal transitions,
heartbeats against terminal sessions) keep 409 `olos.invalid_state`.
Clients that dispatch on the error code can now tell permanently malformed
requests from retryable state conflicts.

All HTTP error responses now include the schema-required `error.code`
next to `error.message`. Every error body now conforms to
`OLOS_ERROR_SCHEMA`. Four new codes exist in `OLOS_ERROR_CODES`:
`olos.invalid_request`, `olos.not_found`, `olos.method_not_allowed`, and
`olos.conflict`. This change breaks consumers that match the previous
`{ error: { message } }` shape.
