---
"@arsenstorm/olos": minor
---

sqlite/D1 serialized-store backend now implements the `loadCursorView` fast
path via a new nullable `cursor_view` column. Existing deployments must add
the column manually (`create table if not exists` does not alter existing
tables): `ALTER TABLE olos_coordinator_snapshots ADD COLUMN cursor_view TEXT`.
Rows with a NULL `cursor_view` fall back to the full-snapshot path. D1-style
clients whose `first()` resolves `null` for missing rows no longer throw on
load, and serialized cursor views are validated on read instead of cast.
