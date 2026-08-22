import type {
  SerializedCoordinatorStoreBackend,
  SerializedCoordinatorStoreConflict,
  SerializedCoordinatorStoreRecord,
  SerializedCoordinatorStoreSave,
  SerializedCursorViewRecord,
} from "./serialized-store";

export function isSerializedCoordinatorStoreConflict(
  result: SerializedCoordinatorStoreSave
): result is SerializedCoordinatorStoreConflict {
  return result.status === "conflict";
}

/** A fresh backend has nothing to load, and a first insert needs no etag. */
export async function assertSerializedInsertConformance(
  backend: SerializedCoordinatorStoreBackend,
  sessionId: string,
  first: SerializedCoordinatorStoreRecord,
  firstView: SerializedCursorViewRecord
): Promise<void> {
  expectSerializedBackendValue(
    await backend.load(sessionId),
    undefined,
    "new serialized backend must not load missing sessions"
  );

  assertSerializedBackendSaved(
    await backend.save({ cursorView: firstView, record: first, sessionId }),
    "insert without expected etag must save"
  );
}

/** A re-insert and a stale etag both lose the compare-and-swap. */
export async function assertSerializedConflictConformance(
  backend: SerializedCoordinatorStoreBackend,
  sessionId: string,
  first: SerializedCoordinatorStoreRecord,
  firstView: SerializedCursorViewRecord
): Promise<void> {
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
      "duplicate insert conflict should expose the current record"
    );
  }

  const staleUpdate = await backend.save({
    cursorView: firstView,
    expectedEtag: "stale",
    record: first,
    sessionId,
  });
  assertSerializedBackendStatus(
    staleUpdate.status,
    "conflict",
    "stale update must conflict"
  );
}

/** A save presenting the current etag lands and becomes the loaded record. */
export async function assertSerializedUpdateConformance(
  backend: SerializedCoordinatorStoreBackend,
  sessionId: string,
  expected: { etag: string },
  next: {
    record: SerializedCoordinatorStoreRecord;
    view: SerializedCursorViewRecord;
  }
): Promise<void> {
  assertSerializedBackendSaved(
    await backend.save({
      cursorView: next.view,
      expectedEtag: expected.etag,
      record: next.record,
      sessionId,
    }),
    "matching expected etag update must save"
  );

  expectSerializedBackendValue(
    (await backend.load(sessionId))?.etag,
    next.record.etag,
    "matching expected etag update must publish the new record"
  );
}

/** `loadCursorView` tracks the latest save and rejects unknown sessions. */
export async function assertSerializedCursorViewConformance(
  backend: SerializedCoordinatorStoreBackend,
  loadCursorView: NonNullable<
    SerializedCoordinatorStoreBackend["loadCursorView"]
  >,
  context: {
    second: SerializedCoordinatorStoreRecord;
    secondView: SerializedCursorViewRecord;
    sessionId: string;
  }
): Promise<void> {
  const { second, secondView, sessionId } = context;
  const latestView = await loadCursorView(sessionId);

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
    await loadCursorView("missing_serialized_store_conformance"),
    undefined,
    "loadCursorView must not load missing sessions"
  );

  await assertNullCursorViewConformance(backend, loadCursorView, {
    expectedEtag: second.etag,
    sessionId,
  });
}

/**
 * A session saved without a cursor view still resolves — as a record whose
 * `view` is null, never as `undefined`.
 */
async function assertNullCursorViewConformance(
  backend: SerializedCoordinatorStoreBackend,
  loadCursorView: NonNullable<
    SerializedCoordinatorStoreBackend["loadCursorView"]
  >,
  context: { expectedEtag: string; sessionId: string }
): Promise<void> {
  const { expectedEtag, sessionId } = context;
  const third = record("3");

  assertSerializedBackendSaved(
    await backend.save({ expectedEtag, record: third, sessionId }),
    "update without a cursor view must save"
  );

  const viewlessRecord = await loadCursorView(sessionId);
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

export function assertSerializedBackendStatus(
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
