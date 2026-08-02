import type { OlosId } from "../types/ids";
import type {
  SaveSerializedCoordinatorStoreOptions,
  SerializedCoordinatorStoreBackend,
  SerializedCoordinatorStoreRecord,
  SerializedCoordinatorStoreSave,
  SerializedCursorViewRecord,
} from "./serialized-store";

const DEFAULT_TABLE_NAME = "olos_coordinator_snapshots";
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Narrowed SQLite client surface the store backend needs: prepared
 * statements with positional binding. Structurally compatible with
 * Cloudflare D1 and other promise-based SQLite clients, so callers can pass
 * their database handle (or a thin wrapper) instead of a specific driver.
 */
export interface SqliteSerializedCoordinatorStoreDatabase {
  prepare(sql: string): SqliteSerializedCoordinatorStoreStatement;
}

/** Prepared statement that binds positional (`?`) parameters. */
export interface SqliteSerializedCoordinatorStoreStatement {
  bind(
    ...values: readonly unknown[]
  ): SqliteSerializedCoordinatorStoreBoundStatement;
}

/** Bound statement ready to fetch one row or execute a write. */
export interface SqliteSerializedCoordinatorStoreBoundStatement {
  /**
   * Resolve the first result row, or no row: Cloudflare D1 resolves `null`
   * for missing rows while other SQLite clients resolve `undefined` — both
   * are accepted.
   */
  first<T>(): Promise<T | null | undefined>;
  run(): Promise<SqliteSerializedCoordinatorStoreRunResult>;
}

/**
 * Result of executing a write statement. The changed-row count may live at
 * the top level (`changes`, better-sqlite3 style) or under `meta.changes`
 * (Cloudflare D1); at least one must be present or the backend throws.
 */
export interface SqliteSerializedCoordinatorStoreRunResult {
  changes?: number;
  meta?: {
    changes?: number;
  };
}

/** Options for `createSqliteSerializedCoordinatorStoreBackend`. */
export interface CreateSqliteSerializedCoordinatorStoreBackendOptions {
  database: SqliteSerializedCoordinatorStoreDatabase;
  /**
   * Snapshot table name; defaults to `"olos_coordinator_snapshots"` and
   * must be a plain SQLite identifier (letters, digits, underscores).
   */
  tableName?: string;
}

/** Options for `createSqliteSerializedCoordinatorStoreSchema`. */
export interface CreateSqliteSerializedCoordinatorStoreSchemaOptions {
  /**
   * Snapshot table name; defaults to `"olos_coordinator_snapshots"` and
   * must be a plain SQLite identifier (letters, digits, underscores).
   */
  tableName?: string;
}

/**
 * Create a `SerializedCoordinatorStoreBackend` on top of a SQLite database
 * (Cloudflare D1 or any client matching the narrowed interface). Pair it
 * with `createSerializedCoordinatorStore` for a full pipeline store, and
 * apply `createSqliteSerializedCoordinatorStoreSchema` first.
 *
 * Optimistic concurrency rides on single atomic statements: inserts use
 * `insert or ignore` and etag-checked updates a conditional `update`, with
 * zero changed rows reported as a conflict that carries the currently
 * stored record when one exists. Implements the `loadCursorView` fast path
 * from the `cursor_view` column; rows with a NULL `cursor_view` (created
 * before the column migration) surface as null-view records so the wrapping
 * store falls back to the full snapshot. Throws when `tableName` is not a
 * plain SQLite identifier.
 */
export function createSqliteSerializedCoordinatorStoreBackend(
  options: CreateSqliteSerializedCoordinatorStoreBackendOptions
): SerializedCoordinatorStoreBackend {
  const tableName = sqliteIdentifier(
    options.tableName ?? DEFAULT_TABLE_NAME,
    "tableName"
  );
  const sql = statements(tableName);

  return {
    load(sessionId) {
      return loadRecord(options.database, sql.load, sessionId);
    },
    loadCursorView(sessionId) {
      return loadCursorViewRecord(
        options.database,
        sql.loadCursorView,
        sessionId
      );
    },
    save(saveOptions) {
      return saveRecord(options.database, sql, saveOptions);
    },
  };
}

/**
 * Return the `create table if not exists` DDL for the snapshot table used
 * by `createSqliteSerializedCoordinatorStoreBackend`. Idempotent — safe to
 * run on every startup or migration. Throws when `tableName` is not a plain
 * SQLite identifier.
 */
export function createSqliteSerializedCoordinatorStoreSchema(
  options: CreateSqliteSerializedCoordinatorStoreSchemaOptions = {}
): string {
  const tableName = sqliteIdentifier(
    options.tableName ?? DEFAULT_TABLE_NAME,
    "tableName"
  );

  return `create table if not exists ${tableName} (
  session_id text primary key,
  etag text not null,
  snapshot text not null,
  cursor_view text
)`;
}

function statements(tableName: string) {
  return {
    insert: `insert or ignore into ${tableName} (session_id, etag, snapshot, cursor_view) values (?, ?, ?, ?)`,
    load: `select etag, snapshot from ${tableName} where session_id = ?`,
    loadCursorView: `select etag, cursor_view from ${tableName} where session_id = ?`,
    update: `update ${tableName} set etag = ?, snapshot = ?, cursor_view = ? where session_id = ? and etag = ?`,
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

  if (row === null || row === undefined) {
    return;
  }

  return {
    etag: row.etag,
    snapshot: row.snapshot,
  };
}

interface SqliteCursorViewRow {
  cursor_view: string | null | undefined;
  etag: string;
}

async function loadCursorViewRecord(
  database: SqliteSerializedCoordinatorStoreDatabase,
  sql: string,
  sessionId: OlosId
): Promise<SerializedCursorViewRecord | undefined> {
  const row = await database
    .prepare(sql)
    .bind(sessionId)
    .first<SqliteCursorViewRow>();

  if (row === null || row === undefined) {
    return;
  }

  return {
    etag: row.etag,
    // NULL cursor_view (a pre-migration row) surfaces as a null view so the
    // wrapping store falls back to the full snapshot.
    view: row.cursor_view ?? null,
  };
}

async function saveRecord(
  database: SqliteSerializedCoordinatorStoreDatabase,
  sql: ReturnType<typeof statements>,
  options: SaveSerializedCoordinatorStoreOptions
): Promise<SerializedCoordinatorStoreSave> {
  const cursorView = options.cursorView?.view ?? null;

  if (options.expectedEtag === undefined) {
    const inserted = await database
      .prepare(sql.insert)
      .bind(
        options.sessionId,
        options.record.etag,
        options.record.snapshot,
        cursorView
      )
      .run();

    return savedOrConflict(database, sql.load, options.sessionId, inserted);
  }

  const updated = await database
    .prepare(sql.update)
    .bind(
      options.record.etag,
      options.record.snapshot,
      cursorView,
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
