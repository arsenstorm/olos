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
  SerializedCoordinatorStoreBackend,
  SerializedCoordinatorStoreConflict,
  SerializedCoordinatorStoreRecord,
  SerializedCoordinatorStoreSave,
  SerializedCursorViewRecord,
} from "./serialized-store";
import {
  assertSerializedBackendStatus,
  assertSerializedConflictConformance,
  assertSerializedCursorViewConformance,
  assertSerializedInsertConformance,
  assertSerializedUpdateConformance,
  cursorView,
  record,
} from "./serialized-store-phases";
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

  await assertSerializedInsertConformance(backend, sessionId, first, firstView);
  await assertSerializedConflictConformance(
    backend,
    sessionId,
    first,
    firstView
  );
  await assertSerializedUpdateConformance(
    backend,
    sessionId,
    { etag: first.etag },
    { record: second, view: secondView }
  );

  if (backend.loadCursorView !== undefined) {
    await assertSerializedCursorViewConformance(
      backend,
      backend.loadCursorView.bind(backend),
      { second, secondView, sessionId }
    );
  }

  await assertSerializedMissingUpdateConformance(backend, first, firstView);
}

/** An update against a session that was never inserted is a conflict. */
async function assertSerializedMissingUpdateConformance(
  backend: SerializedCoordinatorStoreBackend,
  first: SerializedCoordinatorStoreRecord,
  firstView: SerializedCursorViewRecord
): Promise<void> {
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
