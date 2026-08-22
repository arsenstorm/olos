import { createCoordinatorPipeline } from "../protocol/coordinator-lifecycle";
import { issueCoordinatorSlot } from "../protocol/coordinator-slot";
import type {
  CoordinatorCursorView,
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineState,
  CoordinatorPipelineStore,
  CoordinatorStoreSave,
} from "../protocol/coordinator-types";
import type { Session } from "../types/session";

/** Delivery base URL used by every conformance harness session. */
export const CONFORMANCE_DELIVERY_BASE_URL = "https://media.example.com";

/** A minimal live session with one track under a profile-agnostic id. */
const CONFORMANCE_SESSION: Session = {
  createdAt: "2026-01-01T00:00:00.000Z",
  epoch: 1,
  olos: "1.0",
  profile: { id: "conformance" },
  sessionId: "session_1",
  state: "live",
  tracks: [{ trackId: "track_1" }],
};

/** Options for `assertCoordinatorPipelineStoreConformance`. */
export interface AssertCoordinatorPipelineStoreConformanceOptions {
  /** Factory producing a fresh, empty store for the conformance run. */
  createStore(): CoordinatorPipelineStore | Promise<CoordinatorPipelineStore>;
}

/**
 * Conformance harness for `CoordinatorPipelineStore` implementations:
 * verifies load/save round-trips, etag-mismatch and duplicate-insert
 * conflicts, the optional `loadCursor` fast path (matching etag and
 * session, no cursor before a commit), and that the store never aliases
 * caller state objects — including between `loadCursor` views. Throws an
 * `Error` describing the first violated expectation. Run it in the test
 * suite of any custom store.
 */
export async function assertCoordinatorPipelineStoreConformance(
  options: AssertCoordinatorPipelineStoreConformanceOptions
): Promise<void> {
  const store = await options.createStore();
  const initial = createCoordinatorPipeline({
    deliveryBaseUrl: CONFORMANCE_DELIVERY_BASE_URL,
    session: CONFORMANCE_SESSION,
  });

  expectStoreValue(
    await store.load(CONFORMANCE_SESSION.sessionId),
    undefined,
    "new coordinator store must not load missing sessions"
  );

  const first = await assertFirstSaveConformance(store, initial);
  const loaded = await assertLoadConformance(store, initial, first.etag);

  await assertStoreLoadCursorConformance(store, loaded);
  await assertSaveConflictConformance(store, initial, first.etag);
  await assertUpdateConformance(store, loaded, first.etag);

  const missingUpdate = await store.save({
    expectedEtag: "1",
    sessionId: "missing_session",
    state: initial,
  });
  expectStoreValue(
    missingUpdate.status,
    "conflict",
    "missing update must conflict"
  );
}

/** A first save succeeds and must not alias the caller's state object. */
async function assertFirstSaveConformance(
  store: CoordinatorPipelineStore,
  initial: CoordinatorPipelineState
): Promise<Extract<CoordinatorStoreSave, { status: "saved" }>> {
  const first = await store.save({
    sessionId: CONFORMANCE_SESSION.sessionId,
    state: initial,
  });
  assertSavedStoreResult(first, "first save must succeed");
  expectStoreDifferent(
    first.state,
    initial,
    "saved state must not reuse the caller state object"
  );

  return first;
}

/** A load returns the saved etag and deep copies, not shared references. */
async function assertLoadConformance(
  store: CoordinatorPipelineStore,
  initial: CoordinatorPipelineState,
  savedEtag: string
): Promise<CoordinatorPipelineSnapshot> {
  const loaded = await store.load(CONFORMANCE_SESSION.sessionId);
  if (loaded === undefined) {
    throw new Error("saved coordinator state must be loadable");
  }

  expectStoreValue(loaded.etag, savedEtag, "loaded etag must match save etag");
  expectStoreValue(
    loaded.state.session.sessionId,
    CONFORMANCE_SESSION.sessionId,
    "loaded session id must match saved session"
  );
  expectStoreDifferent(
    loaded.state,
    initial,
    "loaded state must not reuse the saved state object"
  );
  expectStoreDifferent(
    loaded.state.session,
    initial.session,
    "loaded session must not reuse the saved session object"
  );

  return loaded;
}

/** Both a stale etag and a re-insert lose the optimistic-concurrency check. */
async function assertSaveConflictConformance(
  store: CoordinatorPipelineStore,
  initial: CoordinatorPipelineState,
  savedEtag: string
): Promise<void> {
  const stale = await store.save({
    expectedEtag: "stale",
    sessionId: CONFORMANCE_SESSION.sessionId,
    state: initial,
  });
  expectStoreValue(stale.status, "conflict", "stale save must conflict");

  const duplicateInsert = await store.save({
    sessionId: CONFORMANCE_SESSION.sessionId,
    state: initial,
  });
  expectStoreValue(
    duplicateInsert.status,
    "conflict",
    "duplicate insert must conflict"
  );

  if (duplicateInsert.status === "conflict") {
    expectStoreValue(
      duplicateInsert.current?.etag,
      savedEtag,
      "duplicate insert conflict should expose current etag when available"
    );
    expectStoreDifferent(
      duplicateInsert.current?.state,
      initial,
      "duplicate insert conflict must not reuse the caller state object"
    );
  }
}

/** A save presenting the current etag succeeds and becomes visible to loads. */
async function assertUpdateConformance(
  store: CoordinatorPipelineStore,
  loaded: CoordinatorPipelineSnapshot,
  savedEtag: string
): Promise<void> {
  const updated = issueCoordinatorSlot({
    contentType: "application/octet-stream",
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: "init",
    maxBytes: 2048,
    sequenceNumber: 0,
    trackId: "track_1",
    slotId: "slot_init",
    state: loaded.state,
  });
  const second = await store.save({
    expectedEtag: savedEtag,
    sessionId: CONFORMANCE_SESSION.sessionId,
    state: updated.state,
  });
  assertSavedStoreResult(second, "matching etag save must succeed");
  expectStoreValue(
    second.state.slots.length,
    1,
    "matching etag save must return updated state"
  );
  expectStoreDifferent(
    second.state,
    updated.state,
    "matching etag save must not reuse the caller state object"
  );

  const reloaded = await store.load(CONFORMANCE_SESSION.sessionId);
  expectStoreValue(
    reloaded?.state.slots.length,
    1,
    "matching etag save must publish updated state"
  );
}

async function assertStoreLoadCursorConformance(
  store: CoordinatorPipelineStore,
  loaded: CoordinatorPipelineSnapshot
): Promise<void> {
  if (store.loadCursor === undefined) {
    return;
  }

  expectStoreValue(
    await store.loadCursor("missing_session"),
    undefined,
    "loadCursor must not load missing sessions"
  );

  const view = await store.loadCursor(CONFORMANCE_SESSION.sessionId);

  if (view === undefined) {
    throw new Error("loadCursor must return a view for saved sessions");
  }

  assertCursorViewFields(view, loaded);

  await assertCursorViewIsolation(
    view,
    await store.loadCursor(CONFORMANCE_SESSION.sessionId),
    loaded
  );
}

/** Each view is a fresh copy — never shared with another view or the snapshot. */
/** The view reports the saved session at the loaded etag, with no cursor. */
function assertCursorViewFields(
  view: CoordinatorCursorView,
  loaded: CoordinatorPipelineSnapshot
): void {
  expectStoreValue(
    view.etag,
    loaded.etag,
    "loadCursor etag must match the loaded snapshot etag"
  );
  expectStoreValue(
    view.session.sessionId,
    CONFORMANCE_SESSION.sessionId,
    "loadCursor session id must match the saved session"
  );
  expectStoreValue(
    view.cursor,
    undefined,
    "loadCursor must not report a cursor before any commit"
  );
}

function assertCursorViewIsolation(
  view: CoordinatorCursorView,
  secondView: CoordinatorCursorView | undefined,
  loaded: CoordinatorPipelineSnapshot
): void {
  expectStoreDifferent(
    view.session,
    secondView?.session,
    "loadCursor views must not share session objects"
  );
  expectStoreDifferent(
    view.session,
    loaded.state.session,
    "loadCursor view must not reuse the loaded snapshot's session object"
  );
}

function assertSavedStoreResult(
  result: CoordinatorStoreSave,
  message: string
): asserts result is Extract<CoordinatorStoreSave, { status: "saved" }> {
  expectStoreValue(result.status, "saved", message);
}

function expectStoreValue<T>(actual: T, expected: T, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

function expectStoreDifferent(
  actual: unknown,
  expected: unknown,
  message: string
): void {
  if (Object.is(actual, expected)) {
    throw new Error(message);
  }
}
