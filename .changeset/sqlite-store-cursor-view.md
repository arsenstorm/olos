---
"@arsenstorm/olos": minor
---

The sqlite/D1 serialized-store backend now implements the
`loadCursorView` fast path through a new nullable `cursor_view` column.
Existing deployments must add the column manually, because
`create table if not exists` does not alter existing tables:
`ALTER TABLE olos_coordinator_snapshots ADD COLUMN cursor_view TEXT`. If a
row has a NULL `cursor_view`, the store falls back to the full-snapshot
path. D1-style clients whose `first()` resolves `null` for missing rows no
longer throw on load. Serialized cursor views are validated on read instead
of cast.
