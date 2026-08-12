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
`OLOS_ERROR_SCHEMA`. Five new codes exist in `OLOS_ERROR_CODES`:
`olos.invalid_request`, `olos.not_found`, `olos.method_not_allowed`,
`olos.conflict`, and `olos.internal`. This change breaks consumers that
match the previous `{ error: { message } }` shape.

The runtime handler no longer crashes on unexpected failures: any throw
that is not an expected 4xx becomes an opaque 500 `olos.internal`
envelope with a fixed message, so store or infrastructure error text
never reaches clients. Three request inputs that previously escaped as
unhandled rejections now resolve to envelopes: a malformed
`?now=` on the retention route and an unsafe `mediaBaseUrl` on session
create are 400 `olos.invalid_request`, and a publisher `committedAt`
ahead of the server clock reads as a fresh cursor in `/health` instead
of failing the request.

The S3 handler now has the same guarantee: every S3 route (grants,
commits, events, completion hints, reconciliation, retention) wraps its
dispatch, so an unexpected throw returns a 500 `olos.internal` envelope
instead of escaping the fetch handler as a platform error. A completion
hint whose object is not yet visible to `HeadObject` answers 409
`olos.invalid_state` and leaves the slot awaiting proof, instead of a
500. A heartbeat whose `now` precedes the lease's `issuedAt` (rewound
clock) rejects with 409 `olos.invalid_state` instead of an opaque 500.
Unknown session actions return 404 `olos.not_found`; 405 with `Allow` is
reserved for real actions requested with the wrong method.

405 responses now carry the RFC 9110-required `Allow` header
(`jsonMethodNotAllowedResponse` takes the allowed-method list). The live
manifest 404 is now a JSON `olos.not_found` envelope instead of plain
text. JSON request bodies are capped (new `maxBodyBytes` handler option,
default 1 MiB); oversized bodies get 413 with an `olos.invalid_request`
envelope. `assertOlosErrorEnvelope` / `isOlosErrorEnvelope` are exported
from `@arsenstorm/olos/validation` for consumers that need to validate
error bodies at runtime.
