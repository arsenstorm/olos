---
"@arsenstorm/olos": minor
---

The sqlite/D1 serialized-store backend now implements the
`loadCursorView` fast path through a new nullable `cursor_view` column.
Existing deployments must add the column manually, because
`create table if not exists` does not alter existing tables:
`ALTER TABLE olos_coordinator_snapshots ADD COLUMN cursor_view TEXT`. If a
row has a NULL `cursor_view` (a pre-migration row), `loadCursorView`
returns a null-view record and the store falls back to the full-snapshot
path, so manifest reads keep working after the column is added.
`SerializedCursorViewRecord.view` is `string | null`: backends return
`undefined` only for missing sessions and a null view for sessions without
a stored view — backends that return `undefined` for existing sessions fail
the conformance harness. D1-style clients whose `first()` resolves `null`
for missing rows no longer throw on load. Serialized cursor views are
validated on read instead of cast.
