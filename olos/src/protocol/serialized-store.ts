import type { Cursor } from "../types/cursor";
import type { OlosId } from "../types/ids";
import type { Session } from "../types/session";
import { assertCursor } from "../validation/cursor";
import { isRecord } from "../validation/fields";
import { assertSession } from "../validation/session";
import {
  cloneCoordinatorPipelineState,
  createNextCoordinatorPipelineEtag,
  cursorViewFromSnapshot,
  parseCoordinatorPipelineSnapshot,
  serializeCoordinatorPipelineSnapshot,
} from "./coordinator-snapshot";
import type {
  CoordinatorCursorView,
  CoordinatorPipelineState,
  CoordinatorPipelineStore,
  CoordinatorStoreSave,
} from "./coordinator-types";

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

type SerializedCoordinatorStoreConflict = Extract<
  SerializedCoordinatorStoreSave,
  { status: "conflict" }
>;

type CoordinatorStoreSaveConflict = Extract<
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
    async loadCursor(sessionId) {
      if (backend.loadCursorView !== undefined) {
        const view = await backend.loadCursorView(sessionId);
        if (view === undefined) {
          return;
        }
        if (view.view !== null) {
          return parseCursorViewRecord({ etag: view.etag, view: view.view });
        }
        // Null view: the session record predates the cursor-view column.
        // Fall through to the full-snapshot path below.
      }

      const record = await backend.load(sessionId);
      return record === undefined
        ? undefined
        : cursorViewFromSnapshot(parseRecord(record));
    },
    async save(options) {
      // The next etag derives from the caller's `expectedEtag` (undefined
      // means insert, so "1") rather than a pre-load of the current record:
      // the load would race concurrent writers anyway, and the backend's
      // atomic etag check is what actually decides — a mismatch comes back
      // as a conflict carrying the winning record.
      const etag = nextSerializedCoordinatorStoreEtag(options.expectedEtag);
      const record = createRecord(etag, options.state);
      const cursorView = createCursorViewRecord(etag, options.state);
      const saved = await backend.save({
        cursorView,
        expectedEtag: options.expectedEtag,
        record,
        sessionId: options.sessionId,
      });

      if (isSerializedCoordinatorStoreConflict(saved)) {
        return coordinatorStoreConflictFromSerialized(saved);
      }

      return {
        etag,
        state: cloneCoordinatorPipelineState(options.state),
        status: "saved",
      };
    },
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

/**
 * Verify a `SerializedCoordinatorStoreBackend` implementation against the
 * contract by exercising a fresh backend end to end: missing sessions load
 * as `undefined`, inserts without `expectedEtag` save, duplicate inserts
 * conflict (exposing the current etag when available), stale or missing
 * `expectedEtag` updates conflict, matching updates publish the new record,
 * and `loadCursorView` (when implemented) reflects the latest saved view,
 * resolves `undefined` only for missing sessions, and returns a null-view
 * record when the session was saved without a cursor view.
 * Throws with a descriptive message on the first violated expectation.
 *
 * Writes test records under fixed conformance session ids, so run it
 * against a disposable backend instance rather than production data.
 */
export async function assertSerializedCoordinatorStoreBackendConformance(
  options: AssertSerializedCoordinatorStoreBackendConformanceOptions
): Promise<void> {
  const backend = await options.createBackend();
  const sessionId = "serialized_store_conformance";
  const first = record("1");
  const firstView = cursorView("1");
  const second = record("2");
  const secondView = cursorView("2");

  expectSerializedBackendValue(
    await backend.load(sessionId),
    undefined,
    "new serialized backend must not load missing sessions"
  );

  assertSerializedBackendSaved(
    await backend.save({ cursorView: firstView, record: first, sessionId }),
    "insert without expected etag must save"
  );

  const duplicateInsert = await backend.save({
    cursorView: firstView,
    record: first,
    sessionId,
  });
  assertSerializedBackendStatus(
    duplicateInsert.status,
    "conflict",
    "duplicate insert must conflict"
  );

  if (isSerializedCoordinatorStoreConflict(duplicateInsert)) {
    expectSerializedBackendValue(
      duplicateInsert.current?.etag,
      first.etag,
      "duplicate insert conflict should expose current etag when available"
    );
  }

  const staleUpdate = await backend.save({
    cursorView: secondView,
    expectedEtag: "stale",
    record: second,
    sessionId,
  });
  assertSerializedBackendStatus(
    staleUpdate.status,
    "conflict",
    "stale update must conflict"
  );

  assertSerializedBackendSaved(
    await backend.save({
      cursorView: secondView,
      expectedEtag: first.etag,
      record: second,
      sessionId,
    }),
    "matching expected etag update must save"
  );

  expectSerializedBackendValue(
    (await backend.load(sessionId))?.etag,
    second.etag,
    "matching expected etag update must publish the new record"
  );

  if (backend.loadCursorView !== undefined) {
    const latestView = await backend.loadCursorView(sessionId);

    expectSerializedBackendValue(
      latestView?.etag,
      second.etag,
      "loadCursorView must reflect the latest saved etag"
    );
    expectSerializedBackendValue(
      latestView?.view,
      secondView.view,
      "loadCursorView must return the latest saved view"
    );
    expectSerializedBackendValue(
      await backend.loadCursorView("missing_serialized_store_conformance"),
      undefined,
      "loadCursorView must not load missing sessions"
    );

    const third = record("3");
    assertSerializedBackendSaved(
      await backend.save({
        expectedEtag: second.etag,
        record: third,
        sessionId,
      }),
      "update without a cursor view must save"
    );

    const viewlessRecord = await backend.loadCursorView(sessionId);
    if (viewlessRecord === undefined) {
      throw new Error(
        "loadCursorView must return a null-view record, not undefined, when the session exists without a stored view"
      );
    }
    expectSerializedBackendValue(
      viewlessRecord.etag,
      third.etag,
      "null-view loadCursorView record must carry the latest etag"
    );
    expectSerializedBackendValue(
      viewlessRecord.view,
      null,
      "loadCursorView must return a null view when the session exists without a stored view"
    );
  }

  const missingUpdate = await backend.save({
    cursorView: firstView,
    expectedEtag: "1",
    record: first,
    sessionId: "missing_serialized_store_conformance",
  });
  assertSerializedBackendStatus(
    missingUpdate.status,
    "conflict",
    "missing update must conflict"
  );
}

function nextSerializedCoordinatorStoreEtag(expectedEtag?: string): string {
  try {
    return createNextCoordinatorPipelineEtag(expectedEtag);
  } catch {
    // A malformed expectedEtag can never match a stored etag (this store
    // only ever writes numeric etags), so the backend save is guaranteed to
    // conflict and the placeholder is never persisted.
    return "0";
  }
}

function createRecord(
  etag: string,
  state: CoordinatorPipelineState
): SerializedCoordinatorStoreRecord {
  return {
    etag,
    snapshot: serializeCoordinatorPipelineSnapshot({ etag, state }),
  };
}

function cloneRecord(
  record: SerializedCoordinatorStoreRecord
): SerializedCoordinatorStoreRecord {
  return {
    etag: record.etag,
    snapshot: record.snapshot,
  };
}

function serializedCoordinatorStoreConflict(
  current?: SerializedCoordinatorStoreRecord
): SerializedCoordinatorStoreConflict {
  return {
    ...(current === undefined ? {} : { current }),
    status: "conflict",
  };
}

function coordinatorStoreConflictFromSerialized(
  conflict: SerializedCoordinatorStoreConflict
): CoordinatorStoreSaveConflict {
  return {
    current:
      conflict.current === undefined
        ? undefined
        : parseRecord(conflict.current),
    status: "conflict",
  };
}

function isSerializedCoordinatorStoreConflict(
  result: SerializedCoordinatorStoreSave
): result is SerializedCoordinatorStoreConflict {
  return result.status === "conflict";
}

function parseRecord(record: SerializedCoordinatorStoreRecord) {
  const snapshot = parseCoordinatorPipelineSnapshot(record.snapshot);

  if (snapshot.etag !== record.etag) {
    throw new Error("serialized coordinator record etag must match snapshot");
  }

  return snapshot;
}

interface ParsedCursorView {
  cursor?: Cursor;
  /**
   * Etag duplicated inside the JSON body so a view row whose columns were
   * torn apart (e.g. a partial copy pairing one session's etag with
   * another's view) is detected on read, mirroring `parseRecord`'s
   * snapshot-etag cross-check.
   */
  etag: string;
  session: Session;
}

function createCursorViewRecord(
  etag: string,
  state: CoordinatorPipelineState
): SerializedCursorViewRecord {
  const view: ParsedCursorView = {
    ...(state.cursor === undefined ? {} : { cursor: state.cursor }),
    etag,
    session: state.session,
  };

  return { etag, view: JSON.stringify(view) };
}

function parseCursorViewRecord(
  record: SerializedCursorViewRecord & { view: string }
): CoordinatorCursorView {
  const parsed: unknown = JSON.parse(record.view);

  assertParsedCursorView(parsed);

  if (parsed.etag !== record.etag) {
    throw new Error("serialized cursor view etag must match record");
  }

  return {
    ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
    etag: record.etag,
    session: parsed.session,
  };
}

function assertParsedCursorView(
  value: unknown
): asserts value is ParsedCursorView {
  if (!isRecord(value)) {
    throw new Error("serialized cursor view must be an object");
  }

  if (typeof value.etag !== "string" || value.etag.length === 0) {
    throw new Error("serialized cursor view must include an etag");
  }

  assertSession(value.session);

  if (value.cursor !== undefined) {
    assertCursor(value.cursor);
  }
}

function record(etag: string): SerializedCoordinatorStoreRecord {
  return {
    etag,
    snapshot: `{"etag":"${etag}"}`,
  };
}

function cursorView(etag: string): SerializedCursorViewRecord {
  return {
    etag,
    view: "{}",
  };
}

function assertSerializedBackendSaved(
  result: SerializedCoordinatorStoreSave,
  message: string
): asserts result is Extract<
  SerializedCoordinatorStoreSave,
  { status: "saved" }
> {
  assertSerializedBackendStatus(result.status, "saved", message);
}

function assertSerializedBackendStatus(
  actual: string,
  expected: string,
  message: string
): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

function expectSerializedBackendValue<T>(
  actual: T,
  expected: T,
  message: string
): void {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}
