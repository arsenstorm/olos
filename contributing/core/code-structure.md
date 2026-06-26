# Code Structure and Layering

OLOS keeps runtime behavior readable by keeping dependencies moving in one
direction through a small set of stable layers.

## Layer order

1. `config`, `types`
2. `validation`
3. `state`
4. `protocol`
5. `runtime`
6. `hls`, `s3`, `client`
7. `conformance`, `scripts`, and public entry points (`olos/src/*.ts` exports)

## Dependency direction

- Higher-numbered layers should import from lower-numbered layers, not the reverse.
- `validation` contains primitive and envelope checks used by transport, state, and
  protocol code paths.
- `state` tracks durable domain objects and core rules.
- `protocol` coordinates state transitions and store behavior.
- `runtime` adapts protocol/state for HTTP and direct publisher usage.
- `s3` adds S3-specific transport and grant/event behavior on top of runtime and
  protocol abstractions.
- `scripts` and public barrel exports should stay mostly leaf-oriented and avoid
  importing from transport-heavy internals unless the item is clearly a test
  fixture or bootstrap concern.

## API boundaries

- Keep public APIs stable in `olas/src/*.ts` facades and `olos/package.json`.
- Prefer public-facing changes only through exported facades plus migration notes.
- Keep transport helpers near their protocol/state use-sites; avoid scattering the
  same parsing or response-shaping logic across layers.

## Test and validation expectations

- Unit tests for protocol/state/runtimes should assert domain logic directly.
- E2E tests should prefer public imports through stable `olos/*` facades.
- Validation-sensitive behavior should have at least one targeted unit test in the
  layer owning the check.

## Review checkpoint

Before changing an internal module, verify the proposed import graph still follows
the layer order and that each file owns one clear concern (validation,
durability, orchestration, transport, or integration). Keep the layer map in
mind when deciding whether new helpers belong in protocol, runtime, or S3.
