import { describe, expect, test } from "bun:test";

import { assertSerializedCoordinatorStoreBackendConformance } from "./serialized-store";
import {
  createSqliteSerializedCoordinatorStoreBackend,
  createSqliteSerializedCoordinatorStoreSchema,
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
  snapshot text not null
)`);
  });

  test("creates schema for a custom safe table name", () => {
    expect(
      createSqliteSerializedCoordinatorStoreSchema({
        tableName: "custom_olos_snapshots",
      })
    ).toContain("create table if not exists custom_olos_snapshots");
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
  });
});

type ChangeResultShape = "changes" | "meta" | "missing";

function createDatabase(
  resultShape: ChangeResultShape = "meta"
): SqliteSerializedCoordinatorStoreDatabase {
  const records = new Map<string, { etag: string; snapshot: string }>();

  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            first<T>() {
              return Promise.resolve(select<T>(records, sql, values));
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

function select<T>(
  records: Map<string, { etag: string; snapshot: string }>,
  sql: string,
  values: readonly unknown[]
): T | undefined {
  if (!sql.startsWith("select")) {
    throw new Error(`unexpected select SQL: ${sql}`);
  }

  return records.get(String(values[0])) as T | undefined;
}

function run(
  records: Map<string, { etag: string; snapshot: string }>,
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
      etag: String(values[1]),
      snapshot: String(values[2]),
    });

    return changed(1, resultShape);
  }

  if (!sql.startsWith("update")) {
    throw new Error(`unexpected update SQL: ${sql}`);
  }

  const sessionId = String(values[2]);
  const expectedEtag = String(values[3]);
  const current = records.get(sessionId);

  if (current?.etag !== expectedEtag) {
    return changed(0, resultShape);
  }

  records.set(sessionId, {
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
