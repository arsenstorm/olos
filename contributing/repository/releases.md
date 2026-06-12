# Releases

The npm package is published from `olos/`.

Before publishing:

```bash
bun install --frozen-lockfile
bun run publish:check
```

`publish:check` runs type checking, Bun unit tests, Vitest E2E tests, build,
dry pack, and a packed-package import smoke test.

Release checklist:

1. Update `olos/package.json` to the intended version.
2. Confirm the changelog or release notes match the diff.
3. Run `bun run publish:check` from the repository root.
4. Run `bun --filter olos release:verify-tag olos-vX.Y.Z`.
5. Push a tag named `olos-vX.Y.Z` to run the publish workflow.
6. Confirm the workflow published from `olos/` with npm provenance enabled.
7. Verify the published package resolves `olos`, `olos/runtime`, and `olos/s3`.

The workflow requires an `NPM_TOKEN` repository secret with publish access.

Do not publish from the repository root. It is a private workspace wrapper, not
the package.
