import type { Cursor } from "../types/cursor";
import type { OlosId } from "../types/ids";
import type { Session } from "../types/session";
import {
  type CoordinatorCursorView,
  type CoordinatorPipelineState,
  type CoordinatorPipelineStore,
  type CoordinatorStoreSave,
  cloneCoordinatorPipelineState,
  createNextCoordinatorPipelineEtag,
  parseCoordinatorPipelineSnapshot,
  serializeCoordinatorPipelineSnapshot,
} from "./coordinator";

export interface SerializedCoordinatorStoreRecord {
  etag: string;
  snapshot: string;
}

// Hot-path view of the persisted state. Backends that store it as a
// separate, smaller record can serve manifest GETs without parsing the
// full snapshot — critical on Workers Free where the per-request CPU
// budget is ~10ms.
export interface SerializedCursorViewRecord {
  etag: string;
  view: string;
}

export interface SerializedCoordinatorStoreBackend {
  load(
    sessionId: OlosId
  ): Promise<SerializedCoordinatorStoreRecord | undefined>;
  loadCursorView?(
    sessionId: OlosId
  ): Promise<SerializedCursorViewRecord | undefined>;
  save(
    options: SaveSerializedCoordinatorStoreOptions
  ): Promise<SerializedCoordinatorStoreSave>;
}

export interface SaveSerializedCoordinatorStoreOptions {
  cursorView?: SerializedCursorViewRecord;
  expectedEtag?: string;
  record: SerializedCoordinatorStoreRecord;
  sessionId: OlosId;
}

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

export interface AssertSerializedCoordinatorStoreBackendConformanceOptions {
  createBackend():
    | SerializedCoordinatorStoreBackend
    | Promise<SerializedCoordinatorStoreBackend>;
}

export interface MemorySerializedCoordinatorStoreBackend
  extends SerializedCoordinatorStoreBackend {
  records: Map<OlosId, SerializedCoordinatorStoreRecord>;
}

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
        return view === undefined ? undefined : parseCursorViewRecord(view);
      }

      const record = await backend.load(sessionId);
      return record === undefined
        ? undefined
        : cursorViewFromSnapshot(parseRecord(record));
    },
    async save(options) {
      const current = await backend.load(options.sessionId);
      const etag = createNextCoordinatorPipelineEtag(current?.etag);
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
    expectSerializedBackendValue(
      (await backend.loadCursorView(sessionId))?.etag,
      second.etag,
      "loadCursorView must reflect the latest saved etag"
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
  session: Session;
}

function createCursorViewRecord(
  etag: string,
  state: CoordinatorPipelineState
): SerializedCursorViewRecord {
  const view: ParsedCursorView = {
    ...(state.cursor === undefined ? {} : { cursor: state.cursor }),
    session: state.session,
  };

  return { etag, view: JSON.stringify(view) };
}

function parseCursorViewRecord(
  record: SerializedCursorViewRecord
): CoordinatorCursorView {
  const parsed = JSON.parse(record.view) as ParsedCursorView;

  return {
    ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
    etag: record.etag,
    session: parsed.session,
  };
}

function cursorViewFromSnapshot(snapshot: {
  etag: string;
  state: CoordinatorPipelineState;
}): CoordinatorCursorView {
  return {
    ...(snapshot.state.cursor === undefined
      ? {}
      : { cursor: snapshot.state.cursor }),
    etag: snapshot.etag,
    session: snapshot.state.session,
  };
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
