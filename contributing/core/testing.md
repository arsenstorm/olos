# Testing

OLOS currently uses Bun's test runner.

Run the default test suite from the repository root:

```bash
bun run test
```

Run the package test suite directly:

```bash
bun --filter olos test
```

Run deterministic E2E tests:

```bash
bun run test:e2e
```

Run the optional live S3-compatible provider check:

```bash
bun run test:live-s3
```

Without `OLOS_LIVE_S3=1`, the live S3 test only verifies that the optional
surface is wired and reports the provider test as skipped. To run against a
provider, set:

```bash
OLOS_LIVE_S3=1
OLOS_LIVE_S3_BUCKET=...
OLOS_LIVE_S3_REGION=...
OLOS_LIVE_S3_ACCESS_KEY_ID=...
OLOS_LIVE_S3_SECRET_ACCESS_KEY=...
```

Optional settings:

```bash
OLOS_LIVE_S3_ENDPOINT=...
OLOS_LIVE_S3_FORCE_PATH_STYLE=true
OLOS_LIVE_S3_PREFIX=olos-live-s3
```

`OLOS_LIVE_S3_FORCE_PATH_STYLE` accepts `true`, `false`, `1`, or `0`.
`OLOS_LIVE_S3_ENDPOINT`, when set, must be an absolute HTTP(S) origin without
a path, query string, or fragment. `OLOS_LIVE_S3_BUCKET` must be a bucket name,
not a bucket plus object prefix.

`OLOS_LIVE_S3_PREFIX` must be a safe relative object prefix. The test rejects
empty prefixes, traversal segments, query strings, fragments, duplicate path
separators, and control characters before contacting the provider.

When enabled, the provider check uploads one object through an OLOS S3 grant,
reuses the same exact-key grant with `If-None-Match: *`, expects the overwrite
attempt to fail, verifies the object through `HeadObject`, and deletes the
object afterwards.

One-shot S3-compatible endpoint example:

```bash
OLOS_LIVE_S3=1 \
OLOS_LIVE_S3_BUCKET=media \
OLOS_LIVE_S3_REGION=auto \
OLOS_LIVE_S3_ACCESS_KEY_ID=... \
OLOS_LIVE_S3_SECRET_ACCESS_KEY=... \
OLOS_LIVE_S3_ENDPOINT=https://s3.example.com \
OLOS_LIVE_S3_PREFIX=olos-live-s3 \
bun run test:live-s3
```

Typecheck and build the publishable package:

```bash
bun run check-types
bun run build
```

## Conventions

- Write assertions inside `test()` blocks.
- Use async/await for asynchronous tests.
- Do not commit `.only` or `.skip` markers.
- Keep test suites shallow and focused.
- Prefer deterministic fixtures for protocol, state-machine, and manifest
  rendering behaviour.
- Include negative tests for hostile-publisher and malformed-state cases when a
  change touches security-sensitive publication paths.

## Test module boundaries

- E2E tests should drive behavior through public package entrypoints in `OLOS`
  and `OLOS/*` so they validate installed-package contracts:
  `OLOS` APIs, configuration, runtime adapters, and user-facing runtime
  behavior.
- Practical rule:
  - Import public subpaths such as `olos`, `olos/runtime`, `olos/s3`,
    `olos/protocol`, and `olos/types` in `olos/e2e/*.test.ts`.
  - Do not import from `olos/src/*` directly in E2E tests.
  - If a test scenario needs behavior not exposed publicly, first expand the
    public API before switching E2E tests to internal imports.
- Unit tests under `olos/src` should remain close to implementation details and
  may import internal modules when directly exercising state transitions,
  parser behavior, and low-level protocol invariants.
- Practical rule:
  - Use local modules for one-off helpers and shared helpers only when reused
    inside the same layer.
  - For reusable unit helpers, keep files near the consuming layer, such as
    `*/test-*.test-helper.ts` or `*/*-fixtures.ts`.
- Keep helpers in the same test scope as the behavior they support; avoid moving
  source helpers into `olos/src` when the helper only exists for a single
  suite.
- Promote reusable test fixtures only after they are needed in at least two suites
  from the same layer (`src` tests together, or E2E tests together), and keep
  the import path explicit about that scope.
- Documented exceptions:
  - E2E tests may import local `./` fixture modules (`./fake-s3-clients.ts`,
    `./wait-for.ts`) only.
  - `src` tests may import a test helper from another `src` suite when deduping
    clear repeated logic.

## Conformance

- [Conformance progress](./conformance.md)
