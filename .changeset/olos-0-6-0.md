---
"@arsenstorm/olos": minor
---

0.6.0 project-wide improvement release.

Infrastructure and tooling:

- Versioning and changelogs migrate to Changesets; package validation
  migrates to `publint` + `@arethetypeswrong/cli` plus a slim packed-tarball
  smoke test that runs under Node, replacing ~25 hand-rolled release
  scripts.
- CI restructured: full-workspace type checking (including `olos/scripts`,
  `olos/live`, benchmarks, and examples), a Node 22/24 matrix for the
  packed package and E2E suite, dependency caching, concurrency groups, and
  job timeouts. Dependabot now regenerates `bun.lock`, and the audit gate is
  clear again.
- Publishing is hardened with an `npm` environment gate and a
  tag-on-main ancestor check, keeping npm OIDC trusted publishing.

Library changes are documented in their own changesets as they land.
