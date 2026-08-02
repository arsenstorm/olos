# Appendix B: Conformance Assertion Catalogue

<!-- GENERATED FILE - DO NOT EDIT. Regenerate with `bun run spec:generate` (in olos/), source: olos/scripts/write-conformance-report.ts -->

This appendix is generated from the conformance metadata in
`olos/src/conformance` (published as `@arsenstorm/olos/conformance`):
one table per conformance level, linking each assertion id to the spec
section that claims it and the test file that covers it.

## Core

| Assertion ID | Spec § | Test file(s) |
| --- | --- | --- |
| `CORE-STORE-001` | — | `src/conformance.test.ts` |
| `CORE-STORE-002` | — | `src/conformance.test.ts` |
| `CORE-STORE-003` | — | `src/conformance.test.ts` |
| `CORE-STORE-004` | — | `src/conformance.test.ts` |
| `CORE-STORE-005` | — | `src/conformance.test.ts` |
| `CORE-STORE-006` | — | `src/protocol/serialized-store.test.ts` |
| `CORE-STORE-007` | — | `src/protocol/serialized-store.test.ts` |
| `CORE-STORE-008` | — | `src/protocol/sqlite-store.test.ts` |
| `CORE-SCHEMA-001` | §3.1 | `src/schema.test.ts` |
| `CORE-SLOT-001` | §4.2 | `src/state/upload-slot.test.ts` |
| `CORE-SLOT-002` | §4.2 | `src/state/upload-slot.test.ts` |
| `CORE-SLOT-003` | §4.5.1 | `src/state/commit.test.ts` |
| `CORE-SLOT-004` | §4.3 | `src/state/upload-slot.test.ts` |
| `CORE-SLOT-005` | §4.3 | `src/state/upload-slot.test.ts` |
| `CORE-SLOT-006` | §4.2 | `src/protocol/coordinator.test.ts` |
| `CORE-SLOT-007` | §4.8 | `src/protocol/coordinator.test.ts` |
| `CORE-COMMIT-001` | §4.5.1 | `src/state/commit.test.ts` |
| `CORE-COMMIT-002` | §4.5.1 | `src/state/commit.test.ts` |
| `CORE-COMMIT-003` | §4.5.1 | `src/state/commit.test.ts` |
| `CORE-COMMIT-004` | §4.5.1 | `src/state/commit.test.ts` |
| `CORE-COMMIT-005` | §4.5.1 | `src/state/commit.test.ts` |
| `CORE-COMMIT-006` | §4.5.2 | `src/state/commit.test.ts` |
| `CORE-COMMIT-007` | §4.5.2 | `src/state/commit.test.ts` |
| `CORE-COMMIT-008` | §5.4 | `src/state/committed-window.test.ts` |
| `CORE-LATE-001` | §4.5.3 | `src/state/commit.test.ts` |
| `CORE-LATE-002` | §4.5.3 | `src/state/commit.test.ts` |
| `CORE-EVENT-001` | §4.4 | `src/state/observed-upload.test.ts` |
| `CORE-EVENT-002` | §4.4 | `src/state/observed-upload.test.ts` |
| `CORE-EVENT-003` | §4.4 | `src/state/observed-upload.test.ts` |
| `CORE-EVENT-004` | §4.4 | `src/state/observed-upload.test.ts` |
| `CORE-EVENT-005` | §4.4 | `src/state/observed-upload.test.ts` |
| `CORE-WINDOW-001` | §4.7 | `src/state/cursor.test.ts` |
| `CORE-WINDOW-002` | — | `src/hls/media-playlist.test.ts` |
| `CORE-WINDOW-003` | §5.1 | `src/validation/committed-window.test.ts` |
| `CORE-WINDOW-004` | §5.1 | `src/validation/committed-window.test.ts` |
| `CORE-WINDOW-005` | §5.1 | `src/validation/committed-window.test.ts` |
| `CORE-WINDOW-006` | — | `src/hls/media-playlist.test.ts` |
| `CORE-WINDOW-007` | §5.2 | `src/state/committed-window.test.ts` |

## Runtime

| Assertion ID | Spec § | Test file(s) |
| --- | --- | --- |
| `CORE-RUNTIME-001` | §6 | `e2e/runtime-pipeline.test.ts` |
| `CORE-RUNTIME-002` | §6 | `e2e/runtime-pipeline.test.ts` |
| `CORE-RUNTIME-003` | §6 | `e2e/runtime-pipeline.test.ts` |
| `CORE-RUNTIME-004` | §6 | `src/runtime/http.test.ts` |
| `CORE-RUNTIME-005` | §6 | `src/runtime/http.test.ts` |
| `CORE-RUNTIME-006` | §9.2 | `src/runtime/retention.test.ts` |
| `CORE-RUNTIME-007` | — | `src/runtime/publisher.test.ts` |
| `CORE-RUNTIME-008` | §6.4.3 | `src/runtime/publisher-lease.test.ts` |
| `CORE-RUNTIME-009` | — | `src/runtime/publisher-plan.test.ts` |
| `CORE-RUNTIME-010` | — | `src/runtime/publisher-expiry.test.ts` |
| `CORE-RUNTIME-011` | §6.4.4 | `src/runtime/health.test.ts` |
| `CORE-RUNTIME-012` | — | `src/runtime/latency-profile.test.ts` |
| `CORE-RUNTIME-013` | — | `src/runtime/publisher-cadence.test.ts` |
| `CORE-RUNTIME-014` | — | `src/runtime/publisher-cadence.test.ts` |
| `CORE-RUNTIME-015` | — | `src/runtime/publisher.test.ts` |
| `CORE-RUNTIME-016` | §6.4 | `src/runtime/session.test.ts` |
| `CORE-RUNTIME-017` | §6 | `src/runtime/http.test.ts` |
| `CORE-RUNTIME-018` | — | `src/runtime/client.test.ts` |
| `CORE-RUNTIME-019` | — | `e2e/runtime-client-flow.test.ts` |
| `CORE-RUNTIME-020` | §6.5.1 | `src/runtime/slot.test.ts` |
| `CORE-RUNTIME-021` | §6.5.2 | `src/runtime/commit.test.ts` |
| `CORE-RUNTIME-022` | §6.7 | `src/runtime/http.test.ts` |
| `CORE-RUNTIME-023` | §6.7 | `src/runtime/http.test.ts` |
| `CORE-RUNTIME-024` | §6.7 | `src/runtime/http.test.ts` |
| `CORE-RUNTIME-025` | §6.3 | `src/runtime/response.test.ts` |

## Object

| Assertion ID | Spec § | Test file(s) |
| --- | --- | --- |
| `OBJ-LAYOUT-001` | §7.5 | `src/runtime/publisher-plan.test.ts` |
| `OBJ-GRANT-001` | §7.2 | `src/s3/upload-grant.test.ts` |
| `OBJ-GRANT-002` | §7.2 | `src/s3/upload-grant.test.ts` |
| `OBJ-GRANT-003` | §7.2 | `src/s3/coordinator.test.ts` |
| `OBJ-GRANT-004` | §7.7 | `src/state/provider-upload-grant-policy.test.ts` |
| `OBJ-GRANT-005` | §7.7 | `src/state/provider-upload-grant-policy.test.ts` |
| `OBJ-HEAD-001` | §7.3 | `src/state/observed-upload.test.ts` |
| `OBJ-PUB-001` | §7.8 | `src/state/publication.test.ts` |
| `OBJ-PUB-002` | §7.8 | `src/state/publication.test.ts` |
| `OBJ-FLOW-001` | §7.9 | `e2e/s3-http-pipeline.test.ts` |
| `OBJ-FLOW-002` | §7.9 | `e2e/object-store-flow.test.ts` |
| `OBJ-FLOW-003` | §7.9 | `e2e/object-store-flow.test.ts` |
| `OBJ-FLOW-004` | — | `src/s3/publisher.test.ts` |
| `OBJ-FLOW-005` | — | `src/s3/http.test.ts` |
| `OBJ-FLOW-006` | — | `src/s3/publisher.test.ts` |
| `OBJ-FLOW-007` | — | `src/s3/publisher.test.ts` |
| `OBJ-FLOW-008` | — | `src/s3/http.test.ts` |
| `OBJ-FLOW-009` | — | `src/s3/publisher.test.ts` |
| `OBJ-FLOW-010` | — | `src/s3/http.test.ts` |
| `OBJ-FLOW-011` | — | `e2e/runtime-pipeline.test.ts` |
| `OBJ-FLOW-012` | — | `src/s3/publisher.test.ts` |
| `OBJ-FLOW-013` | — | `e2e/s3-http-pipeline.test.ts` |
| `OBJ-RUNTIME-001` | §6.6 | `src/s3/http.test.ts` |
| `OBJ-RUNTIME-002` | §6.6 | `src/s3/http.test.ts` |
| `OBJ-RUNTIME-003` | §6.6 | `src/s3/http.test.ts` |
| `OBJ-RUNTIME-004` | §6.6 | `src/s3/http.test.ts` |
| `OBJ-RUNTIME-005` | §6.6 | `src/s3/http.test.ts` |
| `OBJ-RUNTIME-006` | §6.6 | `src/s3/http.test.ts` |
| `OBJ-RUNTIME-007` | §6.6 | `src/s3/http.test.ts` |
| `OBJ-RUNTIME-008` | — | `e2e/s3-http-pipeline.test.ts` |
| `OBJ-RUNTIME-009` | — | `e2e/s3-http-pipeline.test.ts` |
| `OBJ-RUNTIME-010` | §6.6 | `src/s3/http.test.ts` |
| `OBJ-RUNTIME-011` | §6.6 | `src/s3/http.test.ts` |
| `OBJ-RUNTIME-012` | §6.6 | `src/s3/http.test.ts` |
| `OBJ-RUNTIME-013` | §6.6 | `src/s3/http.test.ts` |
| `OBJ-RUNTIME-014` | — | `e2e/s3-http-pipeline.test.ts` |
| `OBJ-CACHE-001` | §10.4 | `src/state/cache-policy.test.ts` |
| `OBJ-CACHE-002` | §10.4 | `src/state/direct-public-security-policy.test.ts` |
| `OBJ-CACHE-003` | §10.4 | `src/state/cache-policy.test.ts` |
| `OBJ-CACHE-004` | §10.4 | `src/state/direct-public-security-policy.test.ts` |
| `OBJ-CACHE-005` | §10.4 | `src/state/direct-public-security-policy.test.ts` |

## HLS

| Assertion ID | Spec § | Test file(s) |
| --- | --- | --- |
| `HLS-GOLDEN-001` | §8.2 | `src/hls/master-playlist.test.ts` |
| `HLS-GOLDEN-002` | §8.4 | `src/hls/media-playlist.test.ts` |
| `HLS-GOLDEN-003` | §8.4 | `src/hls/media-playlist.test.ts` |
| `HLS-GOLDEN-004` | §8.4 | `src/hls/media-playlist.test.ts` |
| `HLS-GOLDEN-005` | §8.4 | `src/hls/media-playlist.test.ts` |
| `HLS-GOLDEN-006` | §8.4 | `src/hls/media-playlist.test.ts` |
| `HLS-GOLDEN-007` | §8.4 | `src/hls/media-playlist.test.ts` |
| `HLS-GOLDEN-008` | §8.4 | `src/hls/media-playlist.test.ts` |
| `HLS-GOLDEN-009` | §8.2 | `src/hls/master-playlist.test.ts` |
| `HLS-GOLDEN-010` | §8.4 | `src/hls/media-playlist.test.ts` |
| `HLS-GOLDEN-011` | §8.4 | `src/hls/media-playlist.test.ts` |
| `HLS-ENDLIST-001` | §8.5.2 | `src/hls/manifest-artifacts.test.ts` |
| `HLS-HOLDBACK-001` | §8.4.1 | `src/hls/media-playlist.test.ts` |
| `HLS-BLOCK-001` | §8.6 | `src/hls/blocking-reload.test.ts` |
| `HLS-BLOCK-002` | §8.6 | `src/hls/manifest-artifacts.test.ts` |
| `HLS-BLOCK-003` | §8.6 | `e2e/runtime-client-flow.test.ts` |
| `HLS-BYTERANGE-001` | §8.5 | `src/validation/byterange.test.ts` |
| `HLS-BYTERANGE-002` | §8.5 | `src/hls/media-playlist.test.ts` |
| `HLS-BYTERANGE-003` | §8.5 | `src/hls/media-playlist.test.ts` |
| `HLS-AUDIO-001` | §8.3 | `src/hls/master-playlist.test.ts` |
| `HLS-AUDIO-002` | §8.3 | `src/hls/master-playlist.test.ts` |
| `HLS-AVAIL-001` | §8.2 | `src/hls/manifest-artifacts.test.ts` |

## Security

| Assertion ID | Spec § | Test file(s) |
| --- | --- | --- |
| `SEC-DIRECT-004` | §10.3 | `src/s3/http.test.ts` |
| `SEC-DIRECT-001` | §10.2 | `src/state/direct-public-security-policy.test.ts` |
| `SEC-DIRECT-002` | §10.5 | `src/validation/upload-slot.test.ts` |
| `SEC-DIRECT-003` | §10.3 | `src/s3/http.test.ts` |
| `SEC-DIRECT-005` | §10.5 | `src/validation/upload-slot.test.ts` |
| `SEC-DIRECT-006` | §10.3 | `src/s3/http.test.ts` |
| `SEC-DIRECT-007` | §10.3 | `src/s3/http.test.ts` |

## Unreferenced assertions

The following assertions are enforced by the reference implementation
but are not yet referenced by a spec section:

- `CORE-STORE-001`
- `CORE-STORE-002`
- `CORE-STORE-003`
- `CORE-STORE-004`
- `CORE-STORE-005`
- `CORE-STORE-006`
- `CORE-STORE-007`
- `CORE-STORE-008`
- `CORE-WINDOW-002`
- `CORE-WINDOW-006`
- `CORE-RUNTIME-007`
- `CORE-RUNTIME-009`
- `CORE-RUNTIME-010`
- `CORE-RUNTIME-012`
- `CORE-RUNTIME-013`
- `CORE-RUNTIME-014`
- `CORE-RUNTIME-015`
- `CORE-RUNTIME-018`
- `CORE-RUNTIME-019`
- `OBJ-FLOW-004`
- `OBJ-FLOW-005`
- `OBJ-FLOW-006`
- `OBJ-FLOW-007`
- `OBJ-FLOW-008`
- `OBJ-FLOW-009`
- `OBJ-FLOW-010`
- `OBJ-FLOW-011`
- `OBJ-FLOW-012`
- `OBJ-FLOW-013`
- `OBJ-RUNTIME-008`
- `OBJ-RUNTIME-009`
- `OBJ-RUNTIME-014`
