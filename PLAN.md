# Maintainability Plan

This plan is based on a full pass through the OLOS repository on June 21, 2026: package metadata, public exports, source modules, tests, scripts, docs, conformance coverage, and release tooling.

## Instructions For The Next Model

You are a senior staff engineer improving maintainability while keeping this project up-to-spec. Preserve public APIs, wire formats, package exports, conformance assertion IDs, security behavior, README examples, and release gates unless the user explicitly approves a compatibility change.

Work in small, reviewable iterations:

- Inspect the named files and nearby tests before editing.
- Fix one coherent maintainability concern per iteration.
- Prefer local helper extraction, stronger types, clearer fixtures, and explicit invariants over broad rewrites.
- Keep public facade files and `olos/package.json` exports stable unless the task is explicitly about public API.
- Add or update tests for changed behavior, public types, package artifacts, shared helpers, or scripts.
- Run narrow checks first, then broaden when a change crosses layers.
- Do not run live S3 tests unless explicitly requested.

Useful checks: `bun --filter olos check-types`, `bun --filter olos test`, `bun --filter olos test:e2e`, `bun --filter olos conformance:check`, `bun --filter olos pack:smoke`, `bun --filter olos publish:check`, `bun x ultracite check`.

## Checklist

- [ ] Split the protocol coordinator into smaller modules.
  - Locations: `olos/src/protocol/coordinator.ts:251`, `:270`, `:376`, `:487`, `:847`, `:970`.
  - Issue: this 1,014-line file owns state creation, in-memory storage, optimistic mutation, commit orchestration, manifest artifacts, retention planning, serialization, cloning, and partial snapshot validation.
  - Suggestion: extract internal modules for state/store, mutation, commit, retention/manifest, and snapshot serialization; keep `protocol/coordinator.ts` as the export facade.
  - Verify: `bun --filter olos test src/protocol src/runtime src/s3` and `bun --filter olos conformance:check`.

- [x] Strengthen coordinator snapshot validation.
  - Locations: `olos/src/protocol/coordinator.ts:366`, `:970`, `:986`, `:1010`.
  - Issue: persisted snapshots validate array shape but not full contents of `pathways`, `slots`, `initCommits`, `commits`, `publisherLeases`, or `cursor`.
  - Suggestion: reuse validators such as `assertPathway`, `assertUploadSlot`, `assertCommit`, and `assertCursor` before cloning loaded state.
  - Verify: add malformed snapshot tests and run protocol store tests.

- [x] Consolidate optimistic stored-mutation retry loops.
  - Locations: `olos/src/protocol/coordinator.ts:376`, `olos/src/runtime/stored.ts:152`, `:197`, `olos/src/s3/coordinator.ts:262`, `:388`.
  - Issue: load, mutate, save, retry, conflict, and not-found handling is repeated with slight variations.
  - Suggestion: create one internal mutation helper with adapters for terminal results and response mapping. Keep public result unions unchanged.
  - Verify: stored runtime, S3 coordinator, serialized store, SQLite store, and conformance tests.

- [ ] Split the S3 HTTP handler by concern.
  - Locations: `olos/src/s3/http.ts:163`, `:233`, `:371`, `:445`, `:548`, `:677`, `:945`.
  - Issue: this 1,051-line file mixes route matching, request parsing, command execution, cursor notification, response DTO shaping, and reconciliation summaries.
  - Suggestion: extract internal route, parse, and response modules while keeping `createStoredS3CoordinatorRuntimeHandler` stable.
  - Verify: `bun --filter olos test src/s3/http.test.ts e2e/s3-http-pipeline.test.ts`.

- [x] Share slot issue payload parsing.
  - Locations: `olos/src/runtime/slot.ts:124`, `olos/src/s3/http.ts:677`.
  - Issue: runtime and S3 routes independently parse the same `RuntimeSlotIssuePayload`.
  - Suggestion: move the parser to one internal module and use it from both callers.
  - Verify: `src/runtime/slot.test.ts` and `src/s3/http.test.ts`.

- [x] Share commit and reconciliation payload parsing helpers.
  - Locations: `olos/src/runtime/commit.ts:150`, `olos/src/s3/http.ts:764`, `:801`, `:860`, `:987`, `:1036`.
  - Issue: timestamp, provider ID, optional object key, late tolerance, max segment, slot ID, and slot ID array parsing are repeated.
  - Suggestion: add focused helpers for common commit timing fields, provider ID resolution, optional object key parsing, and URL-safe string arrays.
  - Verify: runtime commit, S3 HTTP, and S3 reconciliation tests.

- [x] Make completion-hint defaults explicit and injectable.
  - Locations: `olos/src/s3/http.ts:764`, `:781`, `olos/src/s3/coordinator.ts:608`.
  - Issue: completion hints default `commitId` to `complete_${slotId}` and `committedAt` to current time inside parsing code.
  - Suggestion: move those policy choices into a named helper and add optional clock injection through handler options if it stays backward-compatible.
  - Verify: tests for default commit ID and timestamp.

- [x] Make clock usage consistently injectable.
  - Locations: `olos/src/runtime/http.ts:548`, `olos/src/s3/http.ts:781`, `olos/src/s3/upload-grant.ts:134`, `:141`, `:212`, `olos/src/s3/object-observation.ts:122`, `olos/src/hls/blocking-reload.ts:88`, `:106`.
  - Issue: production paths mix explicit timestamps, `now` callbacks, `Date.now()`, and `new Date()`.
  - Suggestion: introduce minimal `now` or clock options at boundaries that need determinism. Preserve defaults.
  - Verify: fixed-clock tests for S3 completion hints, upload grants, object-observation fallback, and HLS blocking reload.

- [x] Replace unsafe HTTP client response casts with validator-backed readers.
  - Locations: `olos/src/runtime/http-client.ts:115`, `:116`, `olos/src/runtime/client.ts:385`, `:393`, `:414`, `olos/src/s3/client.ts:305`, `:325`, `:346`, `:363`, `:380`.
  - Issue: `recordPayload<T>` casts response records to protocol types after only envelope-level checks.
  - Suggestion: validate nested `UploadSlot`, `Commit`, `Cursor`, `UploadGrant`, and response summaries with existing validators where practical.
  - Verify: malformed response tests in runtime and S3 client suites.

- [x] Centralize route defaults and route construction.
  - Locations: `olos/src/runtime/http.ts:53`, `:57`, `olos/src/s3/http.ts:76`, `olos/src/runtime/client.ts:327`, `:331`, `:338`, `olos/src/s3/client.ts:269`, `:278`.
  - Issue: server and client route strings are duplicated across runtime and S3 modules.
  - Suggestion: add internal constants/builders for session, live, S3 action, and completion-hint routes.
  - Verify: route, runtime client, S3 client, runtime HTTP, and S3 HTTP tests.

- [x] Introduce a typed OLOS error builder.
  - Locations: `olos/src/protocol/coordinator.ts:833`, `olos/src/state/commit.ts:285`, `olos/src/state/observed-upload.ts:337`, `olos/src/s3/coordinator.ts:724`, `olos/src/s3/event.ts:138`.
  - Issue: OLOS error objects are assembled ad hoc across modules.
  - Suggestion: create an internal `createOlosError(code, message, details?)` helper and migrate one area at a time.
  - Verify: tests that assert rejection body shapes.

- [x] Reduce schema and validator drift.
  - Locations: `olos/src/schema.ts:212`, `:266`, `:311`, `:352`, `:367`, `:383`, `:398`, `:482`, `:506`, `olos/src/validation/**`.
  - Issue: JSON Schemas and runtime validators encode the same wire contracts independently.
  - Suggestion: add tests that run canonical valid and invalid payloads through both schema expectations and runtime validators. Consider schema-builder helpers for repeated primitives.
  - Verify: `bun --filter olos test src/schema.test.ts src/validation`.

- [ ] Break conformance metadata away from executable store checks.
  - Locations: `olos/src/conformance.ts:10`, `:154`, `:901`, `:915`.
  - Issue: assertion IDs, coverage rows, lookup helpers, and store adapter conformance live in a 1,113-line public file.
  - Suggestion: extract internal coverage data and store checks, then preserve current public exports through `src/conformance.ts`.
  - Verify: conformance tests, report tests, and `conformance:check`.

- [ ] Derive or strongly validate conformance assertion IDs.
  - Locations: `olos/src/conformance.ts:10`, `:154`, `olos/src/conformance.test.ts:27`, `:51`, `olos/scripts/write-conformance-report.ts:41`.
  - Issue: assertion IDs and coverage rows are two hand-maintained lists.
  - Suggestion: derive IDs from a registry or add a `defineConformanceCoverage` helper that enforces uniqueness and completeness.
  - Verify: conformance tests and report script tests.

- [ ] Split the package smoke fixture.
  - Locations: `olos/scripts/package-smoke-fixture.ts:4`, `:140`, `:187`, `:747`.
  - Issue: this 762-line script combines expected runtime exports and large generated JS/TS smoke files.
  - Suggestion: move expected public exports to a public-surface manifest and split runtime smoke and type smoke builders into separate modules.
  - Verify: package smoke fixture tests, package exports tests, and `bun --filter olos pack:smoke`.

- [ ] Unify public export expectations.
  - Locations: `olos/package.json`, `olos/scripts/package-export-map.ts:1`, `olos/scripts/package-smoke-fixture.ts:4`, `olos/scripts/package-exports.test.ts`, `olos/README.md`.
  - Issue: public subpaths are defined in `package.json`, facade files, smoke fixtures, and docs.
  - Suggestion: introduce one internal public-surface manifest that tests compare against `package.json` and smoke expectations.
  - Verify: scripts tests and package smoke.

- [x] Replace the Unix-specific build cleanup command.
  - Location: `olos/package.json` script `build`.
  - Issue: `rm -rf dist && ...` is shell-specific and embeds a destructive command in package metadata.
  - Suggestion: add a small Bun script to remove `dist`, then run TypeScript and declaration import fixing.
  - Verify: `bun --filter olos build`.

- [ ] Tighten TypeScript strictness incrementally.
  - Locations: `tsconfig.json:21`, `:22`, `:23`, `:24`.
  - Issue: unused local/parameter checks and `noPropertyAccessFromIndexSignature` are disabled.
  - Suggestion: measure violations first, then enable one flag at a time only if cleanup is focused.
  - Verify: `bun --filter olos check-types`.

- [ ] Review root `allowJs` and JSX settings.
  - Locations: `tsconfig.json:6`, `:9`.
  - Issue: this package is TypeScript-only and does not use React JSX, but root compiler options enable both.
  - Suggestion: confirm whether tooling or future workspace packages require these settings. If not, remove or move them to a more specific config.
  - Verify: root and package type checks.

- [ ] Extract shared large-test harnesses.
  - Locations: `olos/src/s3/http.test.ts:1`, `:807`, `olos/src/s3/coordinator.test.ts:1`, `olos/e2e/s3-http-pipeline.test.ts:78`, `olos/e2e/object-store-flow.test.ts:116`, `olos/e2e/runtime-client-flow.test.ts:56`.
  - Issue: several important tests exceed 1,000 lines and define similar fake clients, payload builders, setup flows, and wait helpers.
  - Suggestion: create narrow helpers for S3 HTTP harnesses, object-store flow setup, fake S3 clients, and common payload builders. Keep assertions visible in tests.
  - Verify: migrate one suite at a time and run it before broad E2E.

- [ ] Normalize test-helper naming and discovery.
  - Locations: `olos/src/s3/test-client.test-helper.ts`, `olos/src/s3/test-client-helper.test.ts`, `olos/src/s3/test-delete-client.test-helper.ts`, `olos/src/s3/test-delete-client-helper.test.ts`, `olos/src/runtime/test-fetch.test-helper.ts`, `olos/src/runtime/test-fetch-helper.test.ts`, `olos/scripts/test-file-shape.test.ts:9`.
  - Issue: helper modules and companion tests are easy to confuse.
  - Suggestion: document the pattern or move helpers into a clear test-helper directory with matching discovery rules.
  - Verify: test-file-shape and affected helper tests.

- [ ] Strengthen package content checks around accidental private exports.
  - Locations: `olos/scripts/package-contents.ts:8`, `olos/scripts/package-contents.test.ts:54`, `olos/scripts/package-smoke-fixture.ts:4`.
  - Issue: package content and smoke checks are good but spread across several scripts.
  - Suggestion: colocate public-surface intent with package content rules so new exports and private-file exclusions are reviewed together.
  - Verify: scripts tests and pack smoke.

- [ ] Reduce duplicated request-field helpers.
  - Locations: `olos/src/validation/fields.ts:7`, `olos/src/runtime/request-fields.ts:18`, `:200`, `:213`.
  - Issue: runtime request parsing wraps validation helpers but also redefines adjacent concepts such as optional fields, numeric fields, timestamps, and record handling.
  - Suggestion: document the boundary or move truly shared primitives into one internal module.
  - Verify: validation and runtime request field tests.

- [ ] Isolate HTTP response formatting from command logic.
  - Locations: `olos/src/runtime/commit.ts:81`, `olos/src/runtime/slot.ts:91`, `olos/src/runtime/stored.ts:288`, `olos/src/s3/http.ts:331`, `:904`, `:945`.
  - Issue: response status and JSON body construction are embedded in business action functions.
  - Suggestion: create response mapper helpers for runtime slots, runtime commits, S3 commits, S3 events, and S3 reconciliation.
  - Verify: HTTP and client tests.

- [ ] Review commit validation duplication.
  - Locations: `olos/src/protocol/coordinator.ts:626`, `olos/src/state/commit.ts:186`, `:217`, `:235`.
  - Issue: object key, content type, and size checks exist in both coordinator and state commit paths.
  - Suggestion: centralize shared observed-object-versus-slot rejection logic in state, and let coordinator handle policy context.
  - Verify: state commit and coordinator tests.

- [ ] Clarify min-byte enforcement.
  - Locations: `olos/src/state/commit.ts:227`, `olos/src/protocol/coordinator.ts:626`, `olos/src/state/commit.test.ts:220`.
  - Issue: `createCommit` enforces `slot.minBytes`, but earlier structured rejection helpers do not expose a dedicated structured error for too-small objects.
  - Suggestion: decide whether this should become a structured `OlosError` in `resolveCommitAttempt`, then add tests if changed.
  - Verify: state, runtime commit, and coordinator tests.

- [x] Add focused direct-public S3 HTTP security tests.
  - Locations: `olos/src/state/direct-public-security-policy.ts`, `olos/src/s3/http.ts:677`, `olos/src/s3/http.test.ts`.
  - Issue: direct-public safety is covered across validators and route cases, but there is no single route-level boundary test that captures the whole policy surface.
  - Suggestion: add a focused test for unsafe delivery URL, unsafe object key, completion-hint URL rejection, and committed delivery URL provenance.
  - Verify: S3 HTTP and direct-public policy tests.

- [x] Clarify object key, delivery URL, media URI, and route path policies.
  - Locations: `olos/src/validation/object-key.ts`, `olos/src/validation/delivery-url.ts`, `olos/src/hls/uri.ts`, `olos/src/runtime/path.ts`, `olos/src/runtime/publisher-plan.ts`, `olos/src/s3/event.ts:111`.
  - Issue: these policies are distinct and security-sensitive, but the distinction is mostly implicit in tests and names.
  - Suggestion: add brief module-level comments or a contributing guide section describing each policy boundary.
  - Verify: validation, HLS URI, runtime path, and S3 event tests if code changes.

- [x] Make HLS blocking reload time behavior easier to test.
  - Locations: `olos/src/hls/blocking-reload.ts:88`, `:106`, `:174`.
  - Issue: blocking reload uses real `Date.now()` and `setTimeout`.
  - Suggestion: add a small internal clock/sleep abstraction or expose pure deadline calculation.
  - Verify: HLS blocking reload and runtime HTTP tests.

- [x] Keep low-latency defaults in one visible place.
  - Locations: `olos/src/runtime/http.ts:54`, `:56`, `:58`, `olos/src/runtime/latency-profile.ts:65`, `olos/src/runtime/publisher-expiry.ts:3`.
  - Issue: related timing defaults are spread across modules.
  - Suggestion: make `createRuntimeObjectLowLatencyProfile` or an internal defaults module the obvious source of truth.
  - Verify: latency profile, runtime HTTP, publisher expiry, and publisher lease tests.

- [ ] Keep facade export organization deliberate.
  - Locations: `olos/src/runtime.ts:1`, `olos/src/s3.ts:1`, `olos/src/protocol.ts:1`, `olos/src/state.ts:1`, `olos/src/hls.ts:1`, `olos/src/validation.ts:1`, `olos/src/config.ts:1`.
  - Issue: barrel files are intentional public facades with Biome ignores. As exports grow, grouping matters.
  - Suggestion: preserve facades, group exports by concern, and update package smoke coverage when moving internals.
  - Verify: package export and smoke tests.

- [x] Document module-boundary expectations for tests.
  - Locations: `olos/e2e/**`, `olos/src/**`, `contributing/core/testing.md`.
  - Issue: E2E tests mostly use public `olos/*` imports while unit tests use internals, but the rule is implicit.
  - Suggestion: document when to use public subpaths versus internals.
  - Verify: docs-only unless scripts are added.

- [ ] Reduce repeated fake S3 clients.
  - Locations: `olos/src/s3/test-client.test-helper.ts`, `olos/src/s3/test-delete-client.test-helper.ts`, `olos/src/s3/http.test.ts:2992`, `olos/e2e/s3-http-pipeline.test.ts:1256`, `olos/e2e/object-store-flow.test.ts:1324`, `olos/e2e/production-wiring.test.ts:315`.
  - Issue: fake S3 head and delete clients are implemented or adapted in multiple files.
  - Suggestion: create configurable fake object and delete clients with explicit fixtures.
  - Verify: migrate and test one suite at a time.

- [ ] Extract common protocol fixtures.
  - Locations: `olos/src/protocol/coordinator-state.test-helper.ts`, `olos/e2e/conformance-fixtures.ts`, repeated session/pathway/slot fixtures across runtime and S3 tests.
  - Issue: many tests repeat protocol-ready sessions, pathways, slots, and commits.
  - Suggestion: add small immutable fixture builders with clear overrides.
  - Verify: tests for each migrated area.

- [ ] Standardize async wait helpers in tests.
  - Locations: `olos/e2e/runtime-client-flow.test.ts:468`, `olos/e2e/s3-http-pipeline.test.ts:1311`, `olos/e2e/object-store-flow.test.ts:820`.
  - Issue: local polling helpers use hardcoded timeouts and inconsistent failure messages.
  - Suggestion: add one test helper for polling with timeout, interval, and contextual error messages.
  - Verify: affected E2E tests.

- [ ] Keep live S3 tests explicitly isolated.
  - Locations: `olos/live/s3-config.ts:16`, `olos/live/s3.test.ts:142`, `olos/package.json` script `test:live-s3`.
  - Issue: live tests are properly separate, but they use real time and credentials.
  - Suggestion: preserve opt-in behavior and document that ordinary maintainability work should not run live S3 tests.
  - Verify: do not run live S3 unless requested.

- [x] Improve script runner diagnostics.
  - Locations: `olos/scripts/script-runner.ts:11`, `:29`, `:91`.
  - Issue: captured command failures do not include a useful stderr/stdout tail in thrown errors when output forwarding is disabled.
  - Suggestion: include a concise captured-output tail for `runCommandAndCapture` failures.
  - Verify: `olos/scripts/script-runner.test.ts`.

- [ ] Share release/package metadata helpers.
  - Locations: `olos/scripts/verify-release-changelog.ts`, `olos/scripts/verify-published-package.ts`, `olos/scripts/verify-release-tag.ts`, `olos/scripts/write-release-notes.ts`, `olos/scripts/create-package-artifact.ts`.
  - Issue: release scripts import package metadata and derive version/tag/artifact details separately.
  - Suggestion: centralize package version, release tag, artifact name, and package root reads.
  - Verify: release script tests.

- [ ] Keep README examples and smoke fixtures aligned.
  - Locations: `olos/README.md`, `olos/scripts/package-smoke-fixture.ts:187`, `olos/scripts/package-smoke-fixture.test.ts`.
  - Issue: README examples and smoke type fixtures both describe public APIs but can drift.
  - Suggestion: update README and smoke fixture together when public APIs change.
  - Verify: package smoke fixture tests and README fence tests.

- [x] Add a code-structure guide.
  - Locations: `contributing/core/`, `olos/src/`.
  - Issue: the layer order is discoverable but not documented: `config/types` -> `validation` -> `state` -> `protocol` -> `runtime` -> `s3`/`hls` -> clients/scripts.
  - Suggestion: add `contributing/core/code-structure.md` or extend an existing guide with layer ownership and allowed dependency directions.
  - Verify: docs-only unless adding a docs test.

- [ ] Add soft file-size guardrails.
  - Locations: largest files include `olos/src/s3/http.test.ts`, `olos/e2e/object-store-flow.test.ts`, `olos/e2e/s3-http-pipeline.test.ts`, `olos/src/s3/coordinator.test.ts`, `olos/src/conformance.ts`, `olos/src/protocol/coordinator.ts`, `olos/src/s3/http.ts`, `olos/scripts/package-smoke-fixture.ts`.
  - Issue: future changes may continue to accumulate in already-large files.
  - Suggestion: add a reporting script or docs guidance for files above a threshold. Keep it advisory at first.
  - Verify: script test if implemented.

- [ ] Preserve conformance-store adapter checks during store refactors.
  - Locations: `olos/src/conformance.ts:915`, `olos/src/protocol/serialized-store.test.ts`, `olos/src/protocol/sqlite-store.test.ts`, `contributing/core/store-adapters.md`.
  - Issue: store conformance is a key adapter contract and should remain the acceptance boundary.
  - Suggestion: keep or expand checks for cloning, conflict current snapshots, missing updates, duplicate inserts, and conditional saves.
  - Verify: serialized-store, SQLite-store, and conformance tests.

- [ ] Record compatibility intent for every public-facing cleanup.
  - Locations: `CHANGELOG.md`, `olos/README.md`, `contributing/repository/releases.md`.
  - Issue: most maintainability work should be behavior-preserving, but any behavior change must be explicit.
  - Suggestion: in commits/PRs, state whether public behavior is unchanged. Update docs/changelog when behavior changes.
  - Verify: release docs tests when docs change.

## Suggested Work Order

1. Shared parsers and route constants.
2. OLOS error builder.
3. Stored mutation retry helper.
4. S3 HTTP file split.
5. Protocol coordinator file split.
6. Client response validation.
7. Conformance and package smoke metadata split.
8. Large test harness extraction.

## Verification Ladder

- Parser or route cleanup: `bun --filter olos test src/runtime src/s3`.
- Coordinator or store cleanup: `bun --filter olos test src/protocol src/runtime src/s3` and `bun --filter olos conformance:check`.
- Public exports or packaging: `bun --filter olos test scripts` and `bun --filter olos pack:smoke`.
- Cross-layer public behavior: `bun --filter olos test` then `bun --filter olos test:e2e`.
- Release-sensitive changes: `bun --filter olos publish:check`.

## Suggested Goal

Use this as the next goal:

`/goal Improve OLOS maintainability using PLAN.md as the authoritative backlog. Work one coherent checklist item at a time, preserve public behavior and conformance, add focused tests for each refactor, run the narrowest useful checks first, commit and push each completed item before starting the next one, and do not run live S3 checks unless explicitly requested.`
