# Repository Checks

Use GitHub branch protection on `main` so changes merge only after the
validation workflow passes.

Required status check:

```text
Validate / Validate
```

That workflow verifies:

- frozen dependency install
- dependency audit
- Ultracite linting
- `publish:check`
- conformance report generation
- package artifact generation

`publish:check` includes changelog verification, conformance coverage checking,
type checking, Bun unit tests, Vitest E2E tests, build, dry pack, and
packed-package smoke testing.

The packed-package smoke test is also the public export guard. It verifies the
documented subpaths and keeps root `olos` limited to protocol metadata
constants, with runtime functionality exposed through explicit subpaths such as
`olos/runtime`, `olos/protocol`, and `olos/s3`. It also type-checks consumer
imports from the packed tarball so runtime, S3, schema, validation, and type
subpaths stay usable after declaration generation.

`publish:check` is deterministic and does not require live cloud credentials.
It proves the package build, public exports, protocol behavior, and local E2E
flows. Provider compatibility still needs `bun run test:live-s3` with real
S3-compatible credentials before relying on a specific storage deployment.

## Merge Rules

- Require pull requests before merging to `main`.
- Require the branch to be up to date before merging when practical.
- Do not bypass failed validation for package, protocol, runtime, HLS, S3, or
  conformance changes.

## Release Rules

Releases are published only from tags named:

```text
olos-vX.Y.Z
```

The publish workflow verifies that the tag matches `olos/package.json`, reruns
`publish:check`, publishes from `olos/` with npm provenance, then verifies the
published package.

Protect release tags with the `olos-v*` pattern where the repository host
supports tag protection. Only maintainers with npm publish access should create
or move release tags.
