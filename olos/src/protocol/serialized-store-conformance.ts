import type {
  AssertSerializedCoordinatorStoreBackendConformanceOptions,
  SerializedCoordinatorStoreBackend,
  SerializedCoordinatorStoreRecord,
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
