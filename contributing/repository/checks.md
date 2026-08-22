# Repository Checks

Use GitHub branch protection on `main` so changes merge only after the
validation workflow passes.

Required status checks:

```text
Validate / Checks
Validate / Package (Node 22)
Validate / Package (Node 24)
```

The `Checks` job runs:

- frozen dependency install
- dependency audit (blocking, all workspaces)
- Ultracite lint
- type checks for every workspace (`olos` with `scripts/` and `live/`,
  `benchmarks`, and all examples)
- Bun unit tests
- conformance coverage checks and report generation

The `Package` job runs per Node version (22 and 24):

- package build
- Vitest E2E tests against `dist`
- `pack:check` — `publint --strict` plus `@arethetypeswrong/cli` against the
  packed tarball
- `pack:smoke` — installs the packed tarball into a scratch consumer and
  imports every export subpath under Node
- package artifact generation (Node 24 leg only)

`publish:check` is the single-command local equivalent. It runs the
conformance checks, the type checks, the unit tests, the build,
`check-types:dist` (the E2E suite against the generated `dist/*.d.ts`), the
E2E tests, `pack:check`, and `pack:smoke`.

`publish:check` is deterministic and needs no live cloud credentials. It
proves the package build, the public exports, the protocol behavior, and
the local E2E flows. Before you rely on a specific storage deployment, run
`bun run test:live-s3` with real S3-compatible credentials.

## Workflow security

- Every workflow starts from `permissions: {}`. Each job grants only what it
  needs.
- All actions are pinned to full commit SHAs. The Zizmor workflow audits the
  workflow files on every push and pull request.
- Checkouts set `persist-credentials: false`. The one exception is
  `release.yml`, because `changesets/action` pushes with the checked-out
  credentials. The exception is recorded in `.github/zizmor.yml`.
- The publish workflow uses no caches. A poisoned cache entry must not be
  able to reach a published artifact.
- Dependabot waits 7 days after an upstream release before it opens an
  update PR. A compromised release is usually found and pulled within days.
- The workflows do not use the `pull_request_target` or `workflow_run`
  triggers.

## Merge Rules

- Require pull requests before merging to `main`.
- Require the branch to be up to date before merging when practical.
- Do not bypass failed validation for package, protocol, runtime, HLS, S3, or
  conformance changes.
- A user-visible change must include a changeset (`bun changeset`). The
  Release PR workflow folds merged changesets into the next version PR.

## Release Rules

Releases are published only from tags named:

```text
olos-vX.Y.Z
```

Changesets drives versioning. When the "Version Packages" PR merges, it
bumps `olos/package.json` and prepends the changelog section. After that
merge, a maintainer pushes the matching `olos-v<version>` tag manually.

The publish workflow makes sure that the tag commit is reachable from
`main`, that the tag matches `olos/package.json`, and that the changelog
has a matching section. It reruns `publish:check`. It publishes from
`olos/` with npm provenance through OIDC trusted publishing, gated by the
`npm` environment. It then checks the published package and creates the
GitHub release from the changelog section.

Protect release tags with the `olos-v*` pattern where the repository host
supports tag protection. Only maintainers with npm publish access can create
or move release tags.
