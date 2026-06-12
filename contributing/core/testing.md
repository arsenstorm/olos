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
