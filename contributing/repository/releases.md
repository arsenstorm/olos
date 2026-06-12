# Releases

The npm package is published from `olos/`.

Before publishing:

```bash
bun install --frozen-lockfile
bun run publish:check
```

`publish:check` verifies the changelog, runs type checking, Bun unit tests,
Vitest E2E tests, build, dry pack, and a packed-package import smoke test.

Release checklist:

1. Update `olos/package.json` to the intended version.
2. Move relevant `CHANGELOG.md` entries from `Unreleased` into the new version.
3. Run `bun run publish:check` from the repository root.
4. Run `bun --filter olos release:verify-tag olos-vX.Y.Z`.
5. Push a tag named `olos-vX.Y.Z` to run the publish workflow.
6. Confirm the workflow published from `olos/` with npm provenance enabled.
7. Verify the published package resolves `olos`, `olos/runtime`, and `olos/s3`.

The workflow requires an `NPM_TOKEN` repository secret with publish access.

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
