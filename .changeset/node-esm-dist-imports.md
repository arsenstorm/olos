---
"@arsenstorm/olos": minor
---

Emitted `dist/*.js` modules now carry explicit `.js` extensions on relative
imports, so the package resolves under Node's ESM loader — previously only
Bun's tolerant resolver could load it. The packed-tarball smoke test runs
under Node when it is available, which is what caught this.
