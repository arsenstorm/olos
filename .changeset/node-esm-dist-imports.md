---
"@arsenstorm/olos": minor
---

Emitted `dist/*.js` modules now carry explicit `.js` extensions on
relative imports. The package now resolves under Node's ESM loader. Before
this change, only Bun's tolerant resolver could load it. The packed-tarball
smoke test now runs under Node when Node is available, and that test found
this error.
