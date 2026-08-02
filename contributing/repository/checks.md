# Repository Checks

Use GitHub branch protection on `main` so changes merge only after the
validation workflow passes.

Required status checks:

```text
Validate / Checks
Validate / Package (Node 22)
Validate / Package (Node 24)
```

The `Checks` job verifies:

- frozen dependency install
- dependency audit (blocking, all workspaces)
- Ultracite linting
- type checking for every workspace (`olos` including `scripts/` and `live/`,
  `benchmarks`, and all examples)
- Bun unit tests
- conformance coverage checking and report generation

The `Package` job runs per Node version (22 and 24):

- package build
- Vitest E2E tests against `dist`
- `pack:check` — `publint --strict` plus `@arethetypeswrong/cli` against the
  packed tarball
- `pack:smoke` — installs the packed tarball into a scratch consumer and
  imports every export subpath under Node
- package artifact generation (Node 24 leg only)

`publish:check` is the single-command local equivalent: conformance check,
type checks (including `check-types:dist`, which type-checks the E2E suite
against the generated `dist/*.d.ts`), unit tests, build, E2E tests,
`pack:check`, and `pack:smoke`.

`publish:check` is deterministic and does not require live cloud credentials.
It proves the package build, public exports, protocol behavior, and local E2E
flows. Provider compatibility still needs `bun run test:live-s3` with real
S3-compatible credentials before relying on a specific storage deployment.

## Merge Rules

- Require pull requests before merging to `main`.
- Require the branch to be up to date before merging when practical.
- Do not bypass failed validation for package, protocol, runtime, HLS, S3, or
  conformance changes.
- User-visible changes must include a changeset (`bun changeset`); the
  Release PR workflow folds merged changesets into the next version PR.

## Release Rules

Releases are published only from tags named:

```text
olos-vX.Y.Z
```

Versioning is driven by Changesets: merging the "Version Packages" PR bumps
`olos/package.json` and prepends the changelog section. After that merge, a
maintainer pushes the matching `olos-v<version>` tag manually.

The publish workflow verifies the tag commit is reachable from `main`, that
the tag matches `olos/package.json` and the changelog has a matching section,
reruns `publish:check`, publishes from `olos/` with npm provenance via OIDC
trusted publishing (gated by the `npm` environment), then verifies the
published package and creates the GitHub release from the changelog section.

Protect release tags with the `olos-v*` pattern where the repository host
supports tag protection. Only maintainers with npm publish access should create
or move release tags.
