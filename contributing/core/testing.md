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

## Conformance

- [Conformance progress](./conformance.md)
