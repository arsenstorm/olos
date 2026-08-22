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

**The Version Packages PR starts with no check runs.** The workflow pushes
its branch with `GITHUB_TOKEN`, and GitHub does not trigger workflows for
events created with that token. When branch protection requires status
checks, satisfy them by manually dispatching the `Validate` and `Zizmor`
workflows on the `changeset-release/main` branch (Actions tab → workflow →
"Run workflow"). The check runs attach to the branch head commit and count
toward the required checks.

## Cutting a release

1. Dispatch `Validate` and `Zizmor` on `changeset-release/main`, then merge
   the "Version Packages" PR once those runs are green.
2. Pull `main` and push the matching tag:

   ```bash
   git pull
   version=$(jq -r .version olos/package.json)
   git tag "olos-v${version}"
   git push origin "olos-v${version}"
   ```

   The tag push is manual by design. Together with the `npm` environment
   approval, it forms the human release gate.

3. Approve the `npm` environment when the publish workflow requests it.

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
