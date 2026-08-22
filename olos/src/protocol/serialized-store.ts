import type { OlosId } from "../types/ids";
import {
  cloneCoordinatorPipelineState,
  cursorViewFromSnapshot,
} from "./coordinator-snapshot";
import type {
  CoordinatorPipelineStore,
  CoordinatorStoreSave,
  SaveCoordinatorPipelineOptions,
} from "./coordinator-types";
import {
  cloneRecord,
  coordinatorStoreConflictFromSerialized,
  createCursorViewRecord,
  createRecord,
  isSerializedCoordinatorStoreConflict,
  nextSerializedCoordinatorStoreEtag,
  parseCursorViewRecord,
  parseRecord,
  serializedCoordinatorStoreConflict,
} from "./serialized-store-conformance";

/**
 * One persisted coordinator snapshot as an opaque JSON string plus the etag
 * that versions it. `etag` is duplicated outside the JSON so backends can
 * compare-and-swap without parsing the snapshot.
 */
export interface SerializedCoordinatorStoreRecord {
  etag: string;
  /** JSON produced by `serializeCoordinatorPipelineSnapshot`. */
  snapshot: string;
}

/**
 * Hot-path view of the persisted state (session and cursor only). Backends
 * that store it as a separate, smaller record can serve manifest GETs
 * without parsing the full snapshot — critical on Workers Free where the
 * per-request CPU budget is ~10ms.
 */
export interface SerializedCursorViewRecord {
  etag: string;
  /**
   * JSON body of the cursor view; written by the store, treat as opaque.
   * `null` means the session record exists but no view has been persisted
   * for it (for example a sqlite row created before the `cursor_view`
   * migration) — the store then falls back to the full snapshot.
   */
  view: string | null;
}

/**
 * Minimal string-in, string-out persistence contract that
 * `createSerializedCoordinatorStore` adapts into a full
 * `CoordinatorPipelineStore`. Backends only move opaque records; all
 * serialization, parsing, and validation happens in the wrapping store.
 * Implementations must pass
 * `assertSerializedCoordinatorStoreBackendConformance`.
 */
export interface SerializedCoordinatorStoreBackend {
  load(
    sessionId: OlosId
  ): Promise<SerializedCoordinatorStoreRecord | undefined>;
  /**
   * Optional fast path backing `CoordinatorPipelineStore.loadCursor`.
   * Return `undefined` only when the session does not exist. When the
   * session exists but no view is stored, return `{ etag, view: null }` —
   * the store then falls back to the full-snapshot path. A string view is
   * served as-is without consulting `load`.
   */
  loadCursorView?(
    sessionId: OlosId
  ): Promise<SerializedCursorViewRecord | undefined>;
  /**
   * Persist `record` (and `cursorView` when given) under the etag rules of
   * `SaveSerializedCoordinatorStoreOptions.expectedEtag`. The etag check and
   * write must be atomic.
   */
  save(
    options: SaveSerializedCoordinatorStoreOptions
  ): Promise<SerializedCoordinatorStoreSave>;
}

/** Options for `SerializedCoordinatorStoreBackend.save`. */
export interface SaveSerializedCoordinatorStoreOptions {
  /** Companion hot-path record; persist it atomically with `record`. */
  cursorView?: SerializedCursorViewRecord;
  /**
   * Etag of the record the caller loaded. Omit to insert a new session —
   * inserting over an existing record must conflict, as must an etag that
   * no longer matches the stored record or a session that does not exist.
   */
  expectedEtag?: string;
  record: SerializedCoordinatorStoreRecord;
  sessionId: OlosId;
}

/**
 * Result of `SerializedCoordinatorStoreBackend.save`. On `"conflict"` the
 * backend should expose the currently stored record as `current` when it
 * can load one (absent when the session record is missing entirely).
 */
export type SerializedCoordinatorStoreSave =
  | { status: "saved" }
  | {
      current?: SerializedCoordinatorStoreRecord;
      status: "conflict";
    };

export type SerializedCoordinatorStoreConflict = Extract<
  SerializedCoordinatorStoreSave,
  { status: "conflict" }
>;

export type CoordinatorStoreSaveConflict = Extract<
  CoordinatorStoreSave,
  { status: "conflict" }
>;

/** Options for `assertSerializedCoordinatorStoreBackendConformance`. */
export interface AssertSerializedCoordinatorStoreBackendConformanceOptions {
  /** Factory for a fresh, empty backend the conformance run writes into. */
  createBackend():
    | SerializedCoordinatorStoreBackend
    | Promise<SerializedCoordinatorStoreBackend>;
}

/**
 * In-memory serialized backend with its record map exposed so tests can
 * inspect or seed the stored records directly.
 */
export interface MemorySerializedCoordinatorStoreBackend
  extends SerializedCoordinatorStoreBackend {
  /** Live backing map, keyed by session id; not a copy. */
  records: Map<OlosId, SerializedCoordinatorStoreRecord>;
}

/**
 * Adapt a string-based `SerializedCoordinatorStoreBackend` into a full
 * `CoordinatorPipelineStore`. The wrapper owns serialization, etag
 * assignment (monotonic, via `createNextCoordinatorPipelineEtag`), and full
 * validation of every loaded snapshot; the backend only stores and
 * compare-and-swaps opaque records.
 *
 * `loadCursor` has a fast path: when the backend implements
 * `loadCursorView`, only the small session-plus-cursor view record is
 * parsed and the full snapshot is never loaded; otherwise the store falls
 * back to loading and parsing the whole snapshot. A null-view record
 * (session exists, no persisted view — e.g. a pre-migration sqlite row)
 * also falls back to the full snapshot, so manifest reads keep working
 * until the next save rewrites the view. Each `save` also writes a
 * fresh cursor-view record so the fast path stays in sync. Conflict
 * semantics follow `CoordinatorStoreSave`, with the backend's conflicting
 * record parsed back into a snapshot when present.
 */
export function createSerializedCoordinatorStore(
  backend: SerializedCoordinatorStoreBackend
): CoordinatorPipelineStore {
  return {
    async load(sessionId) {
      const record = await backend.load(sessionId);

      return record === undefined ? undefined : parseRecord(record);
    },
    loadCursor: (sessionId) => loadCursorView(backend, sessionId),
    save: (options) => saveRecord(backend, options),
  };
}

async function loadCursorView(
  backend: SerializedCoordinatorStoreBackend,
  sessionId: string
) {
  if (backend.loadCursorView !== undefined) {
    const view = await backend.loadCursorView(sessionId);
    if (view === undefined) {
      return;
    }
    if (view.view !== null) {
      return parseCursorViewRecord({ etag: view.etag, view: view.view });
    }
    // Null view: the session record predates the cursor-view column.
  }

  const record = await backend.load(sessionId);
  return record === undefined
    ? undefined
    : cursorViewFromSnapshot(parseRecord(record));
}

async function saveRecord(
  backend: SerializedCoordinatorStoreBackend,
  options: SaveCoordinatorPipelineOptions
) {
  // The next etag derives from the caller's `expectedEtag` (undefined
  // means insert, so "1") rather than a pre-load of the current record:
  // the load would race concurrent writers anyway, and the backend's
  // atomic etag check is what actually decides — a mismatch comes back
  // as a conflict carrying the winning record.
  const etag = nextSerializedCoordinatorStoreEtag(options.expectedEtag);
  const saved = await backend.save({
    cursorView: createCursorViewRecord(etag, options.state),
    expectedEtag: options.expectedEtag,
    record: createRecord(etag, options.state),
    sessionId: options.sessionId,
  });

  if (isSerializedCoordinatorStoreConflict(saved)) {
    return coordinatorStoreConflictFromSerialized(saved);
  }

  return {
    etag,
    state: cloneCoordinatorPipelineState(options.state),
    status: "saved" as const,
  };
}

/**
 * Create an in-memory `SerializedCoordinatorStoreBackend` for tests and
 * single-process runtimes, with the backing `records` map exposed for
 * inspection. Implements the contract's save semantics — insert only when
 * `expectedEtag` is omitted, etag-checked update otherwise, conflicts
 * carrying the current record when one exists. Records are cloned on load
 * and save so callers never alias stored values. `loadCursorView` is not
 * implemented, so the wrapping store's `loadCursor` falls back to the full
 * snapshot.
 */
export function createMemorySerializedCoordinatorStoreBackend(): MemorySerializedCoordinatorStoreBackend {
  const records = new Map<OlosId, SerializedCoordinatorStoreRecord>();

  return {
    load(sessionId) {
      const record = records.get(sessionId);

      return Promise.resolve(
        record === undefined ? undefined : cloneRecord(record)
      );
    },
    records,
    save(options) {
      const current = records.get(options.sessionId);

      if (current === undefined && options.expectedEtag !== undefined) {
        return Promise.resolve(serializedCoordinatorStoreConflict());
      }

      if (current !== undefined && options.expectedEtag === undefined) {
        return Promise.resolve(
          serializedCoordinatorStoreConflict(cloneRecord(current))
        );
      }

      if (current !== undefined && current.etag !== options.expectedEtag) {
        return Promise.resolve(
          serializedCoordinatorStoreConflict(cloneRecord(current))
        );
      }

      records.set(options.sessionId, cloneRecord(options.record));
      return Promise.resolve({ status: "saved" });
    },
  };
}
