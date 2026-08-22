import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { assertSerializedCoordinatorStoreBackendConformance } from "./serialized-store-conformance";
import {
  createSqliteSerializedCoordinatorStoreBackend,
  createSqliteSerializedCoordinatorStoreSchema,
  migrateSqliteSerializedCoordinatorStoreSchema,
  type SqliteSerializedCoordinatorStoreDatabase,
  type SqliteSerializedCoordinatorStoreRunResult,
} from "./sqlite-store";

describe("SQLite serialized coordinator store backend", () => {
  test("creates the default coordinator snapshot table schema", () => {
    expect(
      createSqliteSerializedCoordinatorStoreSchema()
    ).toBe(`create table if not exists olos_coordinator_snapshots (
  session_id text primary key,
  etag text not null,
  snapshot text not null,
  cursor_view text
)`);
  });

  test("creates schema for a custom safe table name", () => {
    expect(
      createSqliteSerializedCoordinatorStoreSchema({
        tableName: "custom_olos_snapshots",
      })
    ).toContain("create table if not exists custom_olos_snapshots");
  });

  test("uses the schema helper to initialize a SQLite-style backend", async () => {
    const database = createSchemaAwareDatabase();

    database.execute(createSqliteSerializedCoordinatorStoreSchema());

    await expect(
      assertSerializedCoordinatorStoreBackendConformance({
        createBackend: () =>
          createSqliteSerializedCoordinatorStoreBackend({ database }),
      })
    ).resolves.toBeUndefined();
  });

  test("adapts SQLite-style conditional writes", async () => {
    await expect(
      assertSerializedCoordinatorStoreBackendConformance({
        createBackend: () =>
          createSqliteSerializedCoordinatorStoreBackend({
            database: createDatabase(),
          }),
      })
    ).resolves.toBeUndefined();
  });

  test("supports SQLite clients that report top-level changes", async () => {
    await expect(
      assertSerializedCoordinatorStoreBackendConformance({
        createBackend: () =>
          createSqliteSerializedCoordinatorStoreBackend({
            database: createDatabase("changes"),
          }),
      })
    ).resolves.toBeUndefined();
  });

  test("rejects SQLite clients that omit changed row counts", async () => {
    const backend = createSqliteSerializedCoordinatorStoreBackend({
      database: createDatabase("missing"),
    });

    await expect(
      backend.save({
        record: { etag: "1", snapshot: '{"etag":"1"}' },
        sessionId: "session_1",
      })
    ).rejects.toThrow("SQLite run result must include changed row count");
  });

  test("treats D1-style null rows as missing records", async () => {
    const backend = createSqliteSerializedCoordinatorStoreBackend({
      database: createNullRowDatabase(),
    });

    await expect(backend.load("session_missing")).resolves.toBeUndefined();
    await expect(
      backend.loadCursorView?.("session_missing")
    ).resolves.toBeUndefined();
  });

  test("round-trips cursor views through save and loadCursorView", async () => {
    const backend = createSqliteSerializedCoordinatorStoreBackend({
      database: createDatabase(),
    });
    const view = '{"session":{"sessionId":"session_1"}}';

    await expect(
      backend.save({
        cursorView: { etag: "1", view },
        record: { etag: "1", snapshot: '{"etag":"1"}' },
        sessionId: "session_1",
      })
    ).resolves.toEqual({ status: "saved" });
    await expect(backend.loadCursorView?.("session_1")).resolves.toEqual({
      etag: "1",
      view,
    });
  });

  test("returns a null-view record from loadCursorView when cursor_view is null", async () => {
    const backend = createSqliteSerializedCoordinatorStoreBackend({
      database: createDatabase(),
    });

    await expect(
      backend.save({
        record: { etag: "1", snapshot: '{"etag":"1"}' },
        sessionId: "session_1",
      })
    ).resolves.toEqual({ status: "saved" });
    await expect(backend.loadCursorView?.("session_1")).resolves.toEqual({
      etag: "1",
      view: null,
    });
    await expect(backend.load("session_1")).resolves.toEqual({
      etag: "1",
      snapshot: '{"etag":"1"}',
    });
  });

  test("rejects unsafe table names", () => {
    expect(() =>
      createSqliteSerializedCoordinatorStoreBackend({
        database: createDatabase(),
        tableName: "bad table",
      })
    ).toThrow("tableName must be a SQLite identifier");
    expect(() =>
      createSqliteSerializedCoordinatorStoreSchema({
        tableName: "bad table",
      })
    ).toThrow("tableName must be a SQLite identifier");
    expect(
      migrateSqliteSerializedCoordinatorStoreSchema({
        database: createDatabase(),
        tableName: "bad table",
      })
    ).rejects.toThrow("tableName must be a SQLite identifier");
  });
});

describe("SQLite schema migration", () => {
  test("creates the table on an empty database", async () => {
    const database = bunSqliteDatabase(new Database(":memory:"));

    await migrateSqliteSerializedCoordinatorStoreSchema({ database });

    const backend = createSqliteSerializedCoordinatorStoreBackend({ database });

    await expect(backend.load("session_missing")).resolves.toBeUndefined();
    await expect(
      backend.save({
        cursorView: { etag: "1", view: "{}" },
        record: { etag: "1", snapshot: '{"etag":"1"}' },
        sessionId: "session_1",
      })
    ).resolves.toEqual({ status: "saved" });
    await expect(backend.loadCursorView?.("session_1")).resolves.toEqual({
      etag: "1",
      view: "{}",
    });
  });

  test("adds cursor_view to a 0.5.x table and keeps existing rows readable", async () => {
    const db = new Database(":memory:");

    // The 0.5.x schema: no cursor_view column.
    db.run(`create table olos_coordinator_snapshots (
  session_id text primary key,
  etag text not null,
  snapshot text not null
)`);
    db.run(
      "insert into olos_coordinator_snapshots (session_id, etag, snapshot) values (?, ?, ?)",
      ["session_1", "1", '{"etag":"1"}']
    );

    const database = bunSqliteDatabase(db);

    await migrateSqliteSerializedCoordinatorStoreSchema({ database });

    const backend = createSqliteSerializedCoordinatorStoreBackend({ database });

    // Pre-migration rows surface as null views so the wrapping store falls
    // back to the full snapshot.
    await expect(backend.loadCursorView?.("session_1")).resolves.toEqual({
      etag: "1",
      view: null,
    });
    await expect(backend.load("session_1")).resolves.toEqual({
      etag: "1",
      snapshot: '{"etag":"1"}',
    });

    const view = '{"etag":"2","session":{"sessionId":"session_1"}}';

    await expect(
      backend.save({
        cursorView: { etag: "2", view },
        expectedEtag: "1",
        record: { etag: "2", snapshot: '{"etag":"2"}' },
        sessionId: "session_1",
      })
    ).resolves.toEqual({ status: "saved" });
    await expect(backend.loadCursorView?.("session_1")).resolves.toEqual({
      etag: "2",
      view,
    });
  });

  test("re-running the migration is a no-op", async () => {
    const db = new Database(":memory:");
    const database = bunSqliteDatabase(db);

    await migrateSqliteSerializedCoordinatorStoreSchema({ database });
    await expect(
      migrateSqliteSerializedCoordinatorStoreSchema({ database })
    ).resolves.toBeUndefined();

    const columns = db
      .query("select name from pragma_table_info('olos_coordinator_snapshots')")
      .all() as { name: string }[];

    expect(columns.map((column) => column.name)).toEqual([
      "session_id",
      "etag",
      "snapshot",
      "cursor_view",
    ]);
  });

  test("migrated databases pass backend conformance", async () => {
    await expect(
      assertSerializedCoordinatorStoreBackendConformance({
        createBackend: async () => {
          const database = bunSqliteDatabase(new Database(":memory:"));

          await migrateSqliteSerializedCoordinatorStoreSchema({ database });

          return createSqliteSerializedCoordinatorStoreBackend({ database });
        },
      })
    ).resolves.toBeUndefined();
  });
});

// Real bun:sqlite adapter matching the narrowed store interface, so the
// migration runs against actual SQLite DDL and pragma behavior.
function bunSqliteDatabase(
  db: Database
): SqliteSerializedCoordinatorStoreDatabase {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          const bindings = values as never[];

          return {
            first<T>() {
              return Promise.resolve(
                db.query(sql).get(...bindings) as T | null
              );
            },
            run() {
              const result = db.run(sql, bindings);

              return Promise.resolve({ changes: result.changes });
            },
          };
        },
      };
    },
  };
}

interface StoredRow {
  cursor_view: string | null;
  etag: string;
  snapshot: string;
}

type ChangeResultShape = "changes" | "meta" | "missing";

interface SchemaAwareDatabase extends SqliteSerializedCoordinatorStoreDatabase {
  execute(sql: string): void;
}

function createSchemaAwareDatabase(): SchemaAwareDatabase {
  let initialized = false;
  const database = createDatabase();

  return {
    execute(sql) {
      if (
        !sql.startsWith("create table if not exists olos_coordinator_snapshots")
      ) {
        throw new Error(`unexpected schema SQL: ${sql}`);
      }

      initialized = true;
    },
    prepare(sql) {
      if (!initialized) {
        throw new Error("SQLite coordinator table is not initialized");
      }

      return database.prepare(sql);
    },
  };
}

function createNullRowDatabase(): SqliteSerializedCoordinatorStoreDatabase {
  return {
    prepare() {
      return {
        bind() {
          return {
            first<T>() {
              return Promise.resolve<T | null>(null);
            },
            run() {
              return Promise.resolve({ meta: { changes: 0 } });
            },
          };
        },
      };
    },
  };
}

function createDatabase(
  resultShape: ChangeResultShape = "meta"
): SqliteSerializedCoordinatorStoreDatabase {
  const records = new Map<string, StoredRow>();

  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            first<T>() {
              return Promise.resolve(select(records, sql, values) as T);
            },
            run() {
              return Promise.resolve(run(records, sql, values, resultShape));
            },
          };
        },
      };
    },
  };
}

function select(
  records: Map<string, StoredRow>,
  sql: string,
  values: readonly unknown[]
): unknown {
  const row = records.get(String(values[0]));

  if (sql.startsWith("select etag, snapshot")) {
    return row === undefined
      ? undefined
      : { etag: row.etag, snapshot: row.snapshot };
  }

  if (sql.startsWith("select etag, cursor_view")) {
    return row === undefined
      ? undefined
      : { cursor_view: row.cursor_view, etag: row.etag };
  }

  throw new Error(`unexpected select SQL: ${sql}`);
}

function run(
  records: Map<string, StoredRow>,
  sql: string,
  values: readonly unknown[],
  resultShape: ChangeResultShape
): SqliteSerializedCoordinatorStoreRunResult {
  if (sql.startsWith("insert")) {
    const sessionId = String(values[0]);

    if (records.has(sessionId)) {
      return changed(0, resultShape);
    }

    records.set(sessionId, {
      cursor_view: values[3] === null ? null : String(values[3]),
      etag: String(values[1]),
      snapshot: String(values[2]),
    });

    return changed(1, resultShape);
  }

  if (!sql.startsWith("update")) {
    throw new Error(`unexpected update SQL: ${sql}`);
  }

  const sessionId = String(values[3]);
  const expectedEtag = String(values[4]);
  const current = records.get(sessionId);

  if (current?.etag !== expectedEtag) {
    return changed(0, resultShape);
  }

  records.set(sessionId, {
    cursor_view: values[2] === null ? null : String(values[2]),
    etag: String(values[0]),
    snapshot: String(values[1]),
  });

  return changed(1, resultShape);
}

function changed(
  changes: number,
  resultShape: ChangeResultShape
): SqliteSerializedCoordinatorStoreRunResult {
  if (resultShape === "missing") {
    return {};
  }

  return resultShape === "changes" ? { changes } : { meta: { changes } };
}
