import type { Cursor } from "../types/cursor";
import type { Session } from "../types/session";
import { assertCursor } from "../validation/cursor";
import { isRecord } from "../validation/fields";
import { assertSession } from "../validation/session";
import {
  createNextCoordinatorPipelineEtag,
  parseCoordinatorPipelineSnapshot,
  serializeCoordinatorPipelineSnapshot,
} from "./coordinator-snapshot";
import type {
  CoordinatorCursorView,
  CoordinatorPipelineState,
} from "./coordinator-types";
import type {
  AssertSerializedCoordinatorStoreBackendConformanceOptions,
  CoordinatorStoreSaveConflict,
  SerializedCoordinatorStoreConflict,
  SerializedCoordinatorStoreRecord,
  SerializedCoordinatorStoreSave,
  SerializedCursorViewRecord,
} from "./serialized-store";
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

export function nextSerializedCoordinatorStoreEtag(
  expectedEtag?: string
): string {
  try {
    return createNextCoordinatorPipelineEtag(expectedEtag);
  } catch {
    // A malformed expectedEtag can never match a stored etag (this store
    // only ever writes numeric etags), so the backend save is guaranteed to
    // conflict and the placeholder is never persisted.
    return "0";
  }
}

export function createRecord(
  etag: string,
  state: CoordinatorPipelineState
): SerializedCoordinatorStoreRecord {
  return {
    etag,
    snapshot: serializeCoordinatorPipelineSnapshot({ etag, state }),
  };
}

export function cloneRecord(
  record: SerializedCoordinatorStoreRecord
): SerializedCoordinatorStoreRecord {
  return {
    etag: record.etag,
    snapshot: record.snapshot,
  };
}

export function serializedCoordinatorStoreConflict(
  current?: SerializedCoordinatorStoreRecord
): SerializedCoordinatorStoreConflict {
  return {
    ...(current === undefined ? {} : { current }),
    status: "conflict",
  };
}

export function coordinatorStoreConflictFromSerialized(
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

export function isSerializedCoordinatorStoreConflict(
  result: SerializedCoordinatorStoreSave
): result is SerializedCoordinatorStoreConflict {
  return result.status === "conflict";
}

export function parseRecord(record: SerializedCoordinatorStoreRecord) {
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

export function createCursorViewRecord(
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

export function parseCursorViewRecord(
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

export function record(etag: string): SerializedCoordinatorStoreRecord {
  return {
    etag,
    snapshot: `{"etag":"${etag}"}`,
  };
}

export function cursorView(etag: string): SerializedCursorViewRecord {
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
