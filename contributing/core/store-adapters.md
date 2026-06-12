# Store Adapters

The coordinator store is the authority for each live session. A production
adapter must protect one invariant:

```text
cursor state only advances through conditional writes
```

## Contract

The store API has two operations:

```text
load(sessionId) -> current snapshot or undefined
save(sessionId, state, expectedEtag?) -> saved or conflict
```

Use `createSerializedCoordinatorStore` when the database stores an opaque JSON
snapshot and a separate ETag column. The backend owns atomic persistence; OLOS
owns snapshot serialization, parsing, cloning, and ETag sequencing.

## Required Save Semantics

| Case | Behavior |
| --- | --- |
| Missing row, no `expectedEtag` | Insert and return `saved`. |
| Existing row, no `expectedEtag` | Return `conflict`, ideally with current row. |
| Existing row, matching `expectedEtag` | Replace row and return `saved`. |
| Missing or stale `expectedEtag` | Return `conflict`, ideally with current row. |

Returning the current row on conflict lets OLOS retry mutations against the
latest state. If the backend cannot return the current row, OLOS must surface a
conflict to the application.

## SQL Shape

SQLite-compatible stores can use:

```sql
create table olos_coordinator_snapshots (
  session_id text primary key,
  etag text not null,
  snapshot text not null
);
```

The write path should be equivalent to:

```sql
insert into olos_coordinator_snapshots (session_id, etag, snapshot)
values (?, ?, ?)
on conflict do nothing;

update olos_coordinator_snapshots
set etag = ?, snapshot = ?
where session_id = ? and etag = ?;
```

Run the conditional write and conflict read in one transaction when the database
supports it. The adapter must be able to tell whether the insert or update
changed a row.

`createSqliteSerializedCoordinatorStoreBackend` implements this contract for
SQLite-style clients that expose `prepare().bind().first()` and
`prepare().bind().run()`.

## KV and Document Stores

KV-style adapters need compare-and-set, transactions, locks, or a single-writer
authority. A read followed by an unconditional write is not enough; concurrent
publisher, event, recovery, and retention paths can otherwise overwrite cursor
state.

Document stores should keep `sessionId` as the key and `etag` as the conditional
version. The JSON snapshot should be treated as opaque application data except
for migrations.

## Production Checklist

Before using an adapter for a live deployment, verify these properties against
the real backing service:

- Session creation is insert-only. Two concurrent creates for the same
  `sessionId` must produce one saved row and one conflict.
- Every mutation reads the current row, computes the next snapshot, and writes
  it with the previous ETag as the condition.
- Slot issuance, upload commits, provider events, reconciliation, retention,
  session transitions, and publisher heartbeats all share the same conditional
  write path.
- Conflict reads return the current row when possible. This lets OLOS retry
  conflict-safe mutations instead of surfacing avoidable errors to the
  application.
- The adapter never splits a cursor advance across multiple independently
  committed writes.
- Tests run against the same consistency mode as production. Local emulators are
  useful, but they should not be the only proof for databases with weaker
  consistency or optional transactions.

If the backing store cannot provide conditional writes, place a single-writer
service in front of it and expose that service as the coordinator store. Do not
hide a best-effort last-write-wins backend behind the adapter contract.

## Conformance

Every production backend should run:

```ts
import { assertSerializedCoordinatorStoreBackendConformance } from "olos/protocol";

await assertSerializedCoordinatorStoreBackendConformance({
  createBackend: () => createBackendForTestDatabase(),
});
```

That check verifies missing loads, insert conflicts, stale update conflicts,
matching expected-ETag updates, and missing-row update conflicts.

## Operational Notes

- Index by `session_id`; it is the lookup and write key.
- Persist ETag separately from the snapshot so conditional writes are cheap.
- Store snapshots durably before returning `saved`.
- Keep backups and migrations outside OLOS; the package does not own database
  lifecycle.
- Do not split cursor, slots, and commits into separately written records unless
  the adapter can commit the whole state transition atomically.
