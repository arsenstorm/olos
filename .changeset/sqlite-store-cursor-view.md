---
"@arsenstorm/olos": minor
---

The sqlite/D1 serialized-store backend now implements the
`loadCursorView` fast path through a new nullable `cursor_view` column.
Existing deployments upgrade with the new
`migrateSqliteSerializedCoordinatorStoreSchema` (olos/protocol): it runs
the `create table if not exists` DDL and then adds the missing
`cursor_view` column, using only prepared statements (no PRAGMA writes or
transactional DDL, so it works on Cloudflare D1), tolerating racing
migrators, and staying idempotent — safe to run on every startup.
`createSqliteSerializedCoordinatorStoreSchema` alone only covers fresh
installs, because `create table if not exists` does not alter an existing
0.5.x table. If a row has a NULL `cursor_view` (a pre-migration row),
`loadCursorView` returns a null-view record and the store falls back to
the full-snapshot path, so manifest reads keep working after the column
is added. `SerializedCursorViewRecord.view` is `string | null`: backends
return `undefined` only for missing sessions and a null view for sessions
without a stored view — backends that return `undefined` for existing
sessions fail the conformance harness. D1-style clients whose `first()`
resolves `null` for missing rows no longer throw on load. Serialized
cursor views are validated on read instead of cast, and the view JSON now
embeds the record's etag, which is cross-checked on read — a view row
paired with the wrong etag throws instead of serving a stale or foreign
view.
