# Releases

The npm package is published from `olos/`. Versioning and changelogs are
driven by [Changesets](https://github.com/changesets/changesets); publishing
is tag-triggered and uses npm OIDC trusted publishing.

## Changesets

Every user-visible change merges with a changeset:

```bash
bun changeset
```

Pick the bump level (`patch`/`minor`/`major`) and describe the change in
user-facing terms — the text becomes the changelog entry. Behavior-preserving
public-facing cleanups can omit a changeset only when their pull request or
commit explicitly states `Public behavior unchanged`.

Changeset descriptions should cover:

- new or removed public exports
- protocol, runtime, HLS, S3, or storage behavior changes
- migration steps for existing applications
- known compatibility limits or deployment requirements

The `Release PR` workflow (`.github/workflows/release.yml`) maintains a
"Version Packages" PR on every push to `main`: it runs `changeset version`,
which bumps `olos/package.json`, folds pending changesets into
`olos/CHANGELOG.md`, and regenerates `bun.lock` so the PR passes the frozen
lockfile install.

## Cutting a release

1. Merge the "Version Packages" PR once its CI is green.
2. Pull `main` and push the matching tag:

   ```bash
   git pull
   version=$(jq -r .version olos/package.json)
   git tag "olos-v${version}"
   git push origin "olos-v${version}"
   ```

   The tag push is deliberately manual — together with the `npm` environment
   approval it forms the human release gate.

3. Approve the `npm` environment when the publish workflow requests it.

The publish workflow (`.github/workflows/publish.yml`) then:

- verifies the tag commit is reachable from `main`
- verifies the tag matches `olos/package.json` and that `olos/CHANGELOG.md`
  has a matching section
- reruns `publish:check`
- publishes from `olos/` with `npm publish --provenance` — authentication is
  npm **OIDC trusted publishing**: the workflow deletes the setup-node
  `.npmrc` and unsets `NODE_AUTH_TOKEN` so npm authenticates through the
  Trusted Publisher relationship configured on npmjs.com for this repository
  and workflow file. No `NPM_TOKEN` secret exists or is needed.
- verifies the published package installs and imports
  (`release:verify-published`)
- creates a GitHub Release from the changelog section

## Local verification

Before merging release-bound work:

```bash
bun install --frozen-lockfile
bun run publish:check
```

`publish:check` checks conformance coverage, runs type checking (source and
generated `dist` declarations), Bun unit tests, the build, Vitest E2E tests,
`publint` + `@arethetypeswrong/cli` against the packed tarball, and the
packed-package smoke test. It is the deterministic release gate and does not
contact a live S3-compatible provider.

Run `bun run test:live-s3` separately when a release changes S3 upload
grants, object observation, provider events, reconciliation, or retention
behavior that should be proven against a real provider.

After publishing, verify the live package from the repository:

```bash
bun --filter '@arsenstorm/olos' release:verify-published X.Y.Z
```

Pass the npm package version, not the git tag name. Then verify registry
signatures and provenance attestations from a temporary npm consumer project:

```bash
mkdir /tmp/olos-npm-verify
cd /tmp/olos-npm-verify
npm init -y
npm install @arsenstorm/olos@X.Y.Z
npm audit signatures
```

`npm audit signatures` should report verified registry signatures and, for
provenance-enabled releases, at least one verified attestation.

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
