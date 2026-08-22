# Releases

The npm package publishes from `olos/`.
[Changesets](https://github.com/changesets/changesets) drives versioning and
changelogs. A tag push starts the publish, which uses npm OIDC trusted
publishing.

## Changesets

Every user-visible change merges with a changeset:

```bash
bun changeset
```

Pick the bump level (`patch`/`minor`/`major`) and describe the change in
user-facing terms. The text becomes the changelog entry. A cleanup that
keeps public behavior can omit a changeset only when its pull request or
commit states `Public behavior unchanged`.

Changeset descriptions should cover:

- new or removed public exports
- protocol, runtime, HLS, S3, or storage behavior changes
- migration steps for existing applications
- known compatibility limits or deployment requirements

The `Release PR` workflow (`.github/workflows/release.yml`) maintains a
"Version Packages" PR on every push to `main`. The workflow runs
`changeset version`, which bumps `olos/package.json` and folds pending
changesets into `olos/CHANGELOG.md`. It also regenerates `bun.lock` so that
the PR passes the frozen lockfile install.

The workflow pushes and opens the PR with a GitHub App token
(`RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` secrets). Events from the
App trigger the normal checks, so the PR arrives with `Validate` and
`Zizmor` runs. The App must be on the bypass list of the ruleset that
restricts tag creation.

## Cutting a release

1. Merge the "Version Packages" PR once its checks are green.
2. The `Release PR` workflow runs on that merge, finds no pending
   changesets, and pushes the `olos-v<version>` tag for
   `olos/package.json`. The tag push starts the publish workflow.
3. Approve the `npm` environment when the publish workflow requests it.
   This approval is the human release gate.

If the tag push fails, push it by hand from `main`:

```bash
git pull
version=$(jq -r .version olos/package.json)
git tag "olos-v${version}"
git push origin "olos-v${version}"
```

The publish workflow (`.github/workflows/publish.yml`) then:

- makes sure that the tag commit is reachable from `main`
- makes sure that the tag matches `olos/package.json` and that
  `olos/CHANGELOG.md` has a matching section
- reruns `publish:check`
- publishes from `olos/` with `npm publish --provenance`. Authentication is
  npm **OIDC trusted publishing**. The workflow deletes the setup-node
  `.npmrc` and unsets `NODE_AUTH_TOKEN`, so npm authenticates through the
  Trusted Publisher relationship configured on npmjs.com for this repository
  and workflow file. No `NPM_TOKEN` secret exists, and none is necessary.
- makes sure that the published package installs and imports
  (`release:verify-published`)
- creates a GitHub Release from the changelog section

## Local verification

Before merging release-bound work:

```bash
bun install --frozen-lockfile
bun run publish:check
```

`publish:check` runs the conformance checks, the type checks (source and
generated `dist` declarations), the Bun unit tests, the build, the Vitest
E2E tests, `publint` + `@arethetypeswrong/cli` against the packed tarball,
and the packed-package smoke test. It is the deterministic release gate. It
does not contact a live S3-compatible provider.

There is no `prepublishOnly` hook: a local `npm publish` runs no gates and
ships no provenance. Never publish from a workstation — publishes go
through the tag-triggered workflow only. Configure npm Trusted Publishing
for this repository and disallow token-based publishes so a workstation
publish cannot authenticate.

If a release changes S3 upload grants, object observation, provider
events, reconciliation, or retention, run `bun run test:live-s3` against a
real provider.

After publishing, verify the live package from the repository:

```bash
bun --filter '@arsenstorm/olos' release:verify-published X.Y.Z
```

Pass the npm package version, not the git tag name. Then check the
registry signatures and provenance attestations from a temporary npm
consumer project:

```bash
mkdir /tmp/olos-npm-verify
cd /tmp/olos-npm-verify
npm init -y
npm install @arsenstorm/olos@X.Y.Z
npm audit signatures
```

`npm audit signatures` must report verified registry signatures. For a
provenance-enabled release, it must also report at least one verified
attestation.

## Deployment readiness

Treat a deployment as production-ready only after the application also proves:

- publisher and viewer authentication
- tenant/session quotas and kill switches
- a transactional or conditional-write coordinator store
- real S3-compatible provider behavior with `test:live-s3` or equivalent
- media-origin security headers, cache policy, and direct-public controls
- health polling, stale lease alerts, recovery scheduling, and retention retry
  handling

See [repository checks](./checks.md) for branch protection and release tag
protection rules.

Do not publish from the repository root. It is a private workspace wrapper, not
the package.
