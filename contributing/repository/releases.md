# Releases

The npm package is published from `olos/`.

Before publishing:

```bash
bun install --frozen-lockfile
bun run publish:check
```

`publish:check` verifies the changelog, runs type checking, Bun unit tests,
Vitest E2E tests, build, dry pack, and packed-package runtime/type import
smoke tests.
The validation workflow also uploads the generated package tarball as a CI
artifact for inspection.

`publish:check` is the deterministic release gate. It does not contact a live
S3-compatible provider. Run `bun run test:live-s3` separately when a release
changes S3 upload grants, object observation, provider events, reconciliation,
or retention behavior that should be proven against a real provider.

## v0.1 Readiness

Treat `v0.1` as package-ready when these are true:

- The public export map is intentional and verified by packed-package smoke
  tests.
- `publish:check` passes from a clean checkout.
- The conformance report has no unmapped assertions.
- The production wiring E2E passes and is referenced from the production
  pipeline guide.
- README import examples are covered by package smoke tests.
- Known deployment responsibilities are documented as application-owned, not
  implied package behavior.

Treat a deployment as production-ready only after the application also proves:

- publisher and viewer authentication
- tenant/session quotas and kill switches
- a transactional or conditional-write coordinator store
- real S3-compatible provider behavior with `test:live-s3` or equivalent
- media-origin security headers, cache policy, and direct-public controls
- health polling, stale lease alerts, recovery scheduling, and retention retry
  handling

Release checklist:

1. Update `olos/package.json` to the intended version.
2. Move relevant `CHANGELOG.md` entries from `Unreleased` into the new version.
3. Run `bun run publish:check` from the repository root.
4. Run `bun run test:live-s3` when the release needs live provider validation.
5. Run `bun --filter olos release:verify-tag olos-vX.Y.Z`.
6. Push a tag named `olos-vX.Y.Z` to run the publish workflow.
7. Confirm the workflow published from `olos/` with npm provenance enabled.
8. Confirm the workflow verified the published package subpaths.
9. Confirm the workflow created a GitHub Release from the changelog notes.
10. Verify npm registry signatures and provenance attestations from a fresh npm
   install.

The workflow requires an `NPM_TOKEN` repository secret with publish access.
See [repository checks](./checks.md) for the expected branch and release tag
protection rules.

## 0.1.0 Commands

```bash
bun install --frozen-lockfile
bun run publish:check
bun --filter olos release:verify-tag olos-v0.1.0
git tag olos-v0.1.0
git push origin olos-v0.1.0
```

After the workflow finishes, verify the published package from a fresh checkout
or local working tree:

```bash
bun --filter olos release:verify-published 0.1.0
```

Then verify npm signatures and provenance attestations from a temporary npm
consumer project:

```bash
mkdir /tmp/olos-npm-verify
cd /tmp/olos-npm-verify
npm init -y
npm install olos@0.1.0
npm audit signatures
```

`npm audit signatures` should report verified registry signatures. For
provenance-enabled releases, it should also report at least one verified
attestation.

## Release Notes

Every release should include notes that cover:

- new or removed public exports
- protocol, runtime, HLS, S3, or storage behavior changes
- migration steps for existing applications
- known compatibility limits or deployment requirements

Keep release notes focused on user-visible behavior. Internal refactors only
need mention when they affect package users, conformance, or deployment.

Do not publish from the repository root. It is a private workspace wrapper, not
the package.
