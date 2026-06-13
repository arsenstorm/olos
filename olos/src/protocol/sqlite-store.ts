import type { OlosId } from "../types/ids";
import type {
  SaveSerializedCoordinatorStoreOptions,
  SerializedCoordinatorStoreBackend,
  SerializedCoordinatorStoreRecord,
  SerializedCoordinatorStoreSave,
} from "./serialized-store";

const DEFAULT_TABLE_NAME = "olos_coordinator_snapshots";
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface SqliteSerializedCoordinatorStoreDatabase {
  prepare(sql: string): SqliteSerializedCoordinatorStoreStatement;
}

export interface SqliteSerializedCoordinatorStoreStatement {
  bind(
    ...values: readonly unknown[]
  ): SqliteSerializedCoordinatorStoreBoundStatement;
}

export interface SqliteSerializedCoordinatorStoreBoundStatement {
  first<T>(): Promise<T | undefined>;
  run(): Promise<SqliteSerializedCoordinatorStoreRunResult>;
}

export interface SqliteSerializedCoordinatorStoreRunResult {
  changes?: number;
  meta?: {
    changes?: number;
  };
}

export interface CreateSqliteSerializedCoordinatorStoreBackendOptions {
  database: SqliteSerializedCoordinatorStoreDatabase;
  tableName?: string;
}

export function createSqliteSerializedCoordinatorStoreBackend(
  options: CreateSqliteSerializedCoordinatorStoreBackendOptions
): SerializedCoordinatorStoreBackend {
  const tableName = sqliteIdentifier(
    options.tableName ?? DEFAULT_TABLE_NAME,
    "tableName"
  );
  const sql = statements(tableName);

  return {
    async load(sessionId) {
      return await loadRecord(options.database, sql.load, sessionId);
    },
    async save(saveOptions) {
      return await saveRecord(options.database, sql, saveOptions);
    },
  };
}

function statements(tableName: string) {
  return {
    insert: `insert or ignore into ${tableName} (session_id, etag, snapshot) values (?, ?, ?)`,
    load: `select etag, snapshot from ${tableName} where session_id = ?`,
    update: `update ${tableName} set etag = ?, snapshot = ? where session_id = ? and etag = ?`,
  };
}

async function loadRecord(
  database: SqliteSerializedCoordinatorStoreDatabase,
  sql: string,
  sessionId: OlosId
): Promise<SerializedCoordinatorStoreRecord | undefined> {
  const row = await database
    .prepare(sql)
    .bind(sessionId)
    .first<SerializedCoordinatorStoreRecord>();

  if (row === undefined) {
    return;
  }

  return {
    etag: row.etag,
    snapshot: row.snapshot,
  };
}

async function saveRecord(
  database: SqliteSerializedCoordinatorStoreDatabase,
  sql: ReturnType<typeof statements>,
  options: SaveSerializedCoordinatorStoreOptions
): Promise<SerializedCoordinatorStoreSave> {
  if (options.expectedEtag === undefined) {
    const inserted = await database
      .prepare(sql.insert)
      .bind(options.sessionId, options.record.etag, options.record.snapshot)
      .run();

    return savedOrConflict(database, sql.load, options.sessionId, inserted);
  }

  const updated = await database
    .prepare(sql.update)
    .bind(
      options.record.etag,
      options.record.snapshot,
      options.sessionId,
      options.expectedEtag
    )
    .run();

  return savedOrConflict(database, sql.load, options.sessionId, updated);
}

async function savedOrConflict(
  database: SqliteSerializedCoordinatorStoreDatabase,
  loadSql: string,
  sessionId: OlosId,
  result: SqliteSerializedCoordinatorStoreRunResult
): Promise<SerializedCoordinatorStoreSave> {
  if (changedRows(result) > 0) {
    return { status: "saved" };
  }

  return {
    current: await loadRecord(database, loadSql, sessionId),
    status: "conflict",
  };
}

function changedRows(
  result: SqliteSerializedCoordinatorStoreRunResult
): number {
  const changes = result.meta?.changes ?? result.changes;

  if (changes === undefined) {
    throw new Error("SQLite run result must include changed row count");
  }

  return changes;
}

function sqliteIdentifier(value: string, name: string): string {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${name} must be a SQLite identifier`);
  }

  return value;
}
