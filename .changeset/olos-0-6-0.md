---
"@arsenstorm/olos": minor
---

0.6.0 project-wide improvement release.

Infrastructure and tooling:

- Versioning and changelogs migrate to Changesets. Package validation
  migrates to `publint` and `@arethetypeswrong/cli`, plus a slim
  packed-tarball smoke test that runs under Node. These replace about 25
  hand-rolled release scripts.
- CI is restructured. Type checks cover every workspace, including
  `olos/scripts`, `olos/live`, benchmarks, and the examples. A Node 22/24
  matrix builds the package and runs the E2E suite. The workflows gain
  dependency caching, concurrency groups, and job timeouts. Dependabot now
  regenerates `bun.lock`, and the audit gate is clear again.
- Publishing gains an `npm` environment gate and a tag-on-main ancestor
  check. npm OIDC trusted publishing stays in place.

The library changes have their own changesets.
