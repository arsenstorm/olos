import {
  type OlosConformanceAssertionId as MetadataAssertionId,
  type OlosConformanceCoverage as MetadataCoverage,
  type OlosConformanceCoverageStatus as MetadataCoverageStatus,
  type OlosConformanceLevel as MetadataLevel,
  OLOS_CONFORMANCE_ASSERTION_IDS as metadataAssertionIds,
  OLOS_CONFORMANCE_COVERAGE as metadataCoverage,
  getOlosConformanceCoverage as metadataGetOlosConformanceCoverage,
  isOlosConformanceAssertionId as metadataIsOlosConformanceAssertionId,
} from "./conformance/metadata";
import { OLOS_CONFORMANCE_SPEC_REFS as specRefs } from "./conformance/spec-refs";
import { createCoordinatorPipeline } from "./protocol/coordinator-lifecycle";
import { issueCoordinatorSlot } from "./protocol/coordinator-slot";
import type {
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineStore,
  CoordinatorStoreSave,
} from "./protocol/coordinator-types";
import type { AssertSerializedCoordinatorStoreBackendConformanceOptions as SerializedStoreBackendConformanceOptions } from "./protocol/serialized-store";
import { assertSerializedCoordinatorStoreBackendConformance as assertSerializedStoreBackendConformance } from "./protocol/serialized-store-conformance";
import type { Session } from "./types/session";

/**
 * Conformance harness for `SerializedCoordinatorStoreBackend`
 * implementations: exercises insert, etag-checked update, conflict, and
 * cursor-view behavior against a candidate backend, throwing on the first
 * violation. Run it in the test suite of any custom backend.
 */
export const assertSerializedCoordinatorStoreBackendConformance =
  assertSerializedStoreBackendConformance;
/**
 * Options for `assertSerializedCoordinatorStoreBackendConformance`.
 */
export type AssertSerializedCoordinatorStoreBackendConformanceOptions =
  SerializedStoreBackendConformanceOptions;
/**
 * Looks up the coverage entry for a conformance assertion id, or
 * `undefined` for an unknown id.
 */
export const getOlosConformanceCoverage = metadataGetOlosConformanceCoverage;
/** Returns whether `value` is a known OLOS conformance assertion id. */
export const isOlosConformanceAssertionId =
  metadataIsOlosConformanceAssertionId;
/** Every assertion id defined by the OLOS conformance suite. */
export const OLOS_CONFORMANCE_ASSERTION_IDS = metadataAssertionIds;
/**
 * The full conformance coverage table: one entry per assertion id, naming
 * the test file that covers it and whether coverage is complete or
 * partial.
 */
export const OLOS_CONFORMANCE_COVERAGE = metadataCoverage;
/**
 * Spec section number that claims each conformance assertion id (from the
 * `olos-conformance` anchors in `spec/*.md`), or `null` for assertions not
 * yet referenced by a spec section.
 */
export const OLOS_CONFORMANCE_SPEC_REFS = specRefs;
/** Identifier of one assertion in the OLOS conformance suite. */
export type OlosConformanceAssertionId = MetadataAssertionId;
/** One row of the conformance coverage table. */
export type OlosConformanceCoverage = MetadataCoverage;
/** Whether an assertion is fully (`covered`) or partially covered. */
export type OlosConformanceCoverageStatus = MetadataCoverageStatus;
/** Specification area an assertion belongs to (core, hls, object, ...). */
export type OlosConformanceLevel = MetadataLevel;

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
    mediaBaseUrl: CONFORMANCE_MEDIA_BASE_URL,
    session: conformanceSession,
  });

  expectStoreValue(
    await store.load(conformanceSession.sessionId),
    undefined,
    "new coordinator store must not load missing sessions"
  );

  const first = await store.save({
    sessionId: conformanceSession.sessionId,
    state: initial,
  });
  assertSavedStoreResult(first, "first save must succeed");
  expectStoreDifferent(
    first.state,
    initial,
    "saved state must not reuse the caller state object"
  );

  const loaded = await store.load(conformanceSession.sessionId);
  if (loaded === undefined) {
    throw new Error("saved coordinator state must be loadable");
  }

  expectStoreValue(loaded.etag, first.etag, "loaded etag must match save etag");
  expectStoreValue(
    loaded.state.session.sessionId,
    conformanceSession.sessionId,
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

  await assertStoreLoadCursorConformance(store, loaded);

  const stale = await store.save({
    expectedEtag: "stale",
    sessionId: conformanceSession.sessionId,
    state: initial,
  });
  assertStoreStatus(stale.status, "conflict", "stale save must conflict");

  const duplicateInsert = await store.save({
    sessionId: conformanceSession.sessionId,
    state: initial,
  });
  assertStoreStatus(
    duplicateInsert.status,
    "conflict",
    "duplicate insert must conflict"
  );

  if (duplicateInsert.status === "conflict") {
    expectStoreValue(
      duplicateInsert.current?.etag,
      first.etag,
      "duplicate insert conflict should expose current etag when available"
    );
    expectStoreDifferent(
      duplicateInsert.current?.state,
      initial,
      "duplicate insert conflict must not reuse the caller state object"
    );
  }

  const updated = issueCoordinatorSlot({
    contentType: "video/mp4",
    duration: 1,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: "init",
    maxBytes: 2048,
    mediaSequenceNumber: 0,
    renditionId: "v1080",
    slotId: "slot_init",
    state: loaded.state,
  });
  const second = await store.save({
    expectedEtag: first.etag,
    sessionId: conformanceSession.sessionId,
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

  const reloaded = await store.load(conformanceSession.sessionId);
  expectStoreValue(
    reloaded?.state.slots.length,
    1,
    "matching etag save must publish updated state"
  );

  const missingUpdate = await store.save({
    expectedEtag: "1",
    sessionId: "missing_session",
    state: initial,
  });
  assertStoreStatus(
    missingUpdate.status,
    "conflict",
    "missing update must conflict"
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

  const view = await store.loadCursor(conformanceSession.sessionId);

  if (view === undefined) {
    throw new Error("loadCursor must return a view for saved sessions");
  }

  expectStoreValue(
    view.etag,
    loaded.etag,
    "loadCursor etag must match the loaded snapshot etag"
  );
  expectStoreValue(
    view.session.sessionId,
    conformanceSession.sessionId,
    "loadCursor session id must match the saved session"
  );
  expectStoreValue(
    view.cursor,
    undefined,
    "loadCursor must not report a cursor before any commit"
  );

  const secondView = await store.loadCursor(conformanceSession.sessionId);

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
  assertStoreStatus(result.status, "saved", message);
}

function assertStoreStatus(
  actual: string,
  expected: string,
  message: string
): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
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

const conformanceSession: Session = {
  createdAt: "2026-01-01T00:00:00.000Z",
  epoch: 1,
  latencyProfile: "object-ll",
  olos: "1.0",
  partTarget: 0.5,
  renditions: [
    {
      bitrate: 5_000_000,
      codec: "avc1.640028",
      frameRate: 30,
      height: 1080,
      kind: "video",
      renditionId: "v1080",
      width: 1920,
    },
  ],
  segmentTarget: 2,
  sessionId: "session_1",
  state: "live",
};

const CONFORMANCE_MEDIA_BASE_URL = "https://media.example.com";
