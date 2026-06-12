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
4. Publish from `olos/` with npm provenance enabled.
5. Tag the commit as `olos-vX.Y.Z` after the publish succeeds.
6. Verify the published package resolves `olos`, `olos/runtime`, and `olos/s3`.

Do not publish from the repository root. It is a private workspace wrapper, not
the package.
