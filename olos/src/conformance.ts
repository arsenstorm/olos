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
import {
  type CoordinatorPipelineStore,
  type CoordinatorStoreSave,
  createCoordinatorPipeline,
  issueCoordinatorSlot,
} from "./protocol/coordinator";
import type { Pathway } from "./types/pathway";
import type { Session } from "./types/session";

export const getOlosConformanceCoverage = metadataGetOlosConformanceCoverage;
export const isOlosConformanceAssertionId =
  metadataIsOlosConformanceAssertionId;
export const OLOS_CONFORMANCE_ASSERTION_IDS = metadataAssertionIds;
export const OLOS_CONFORMANCE_COVERAGE = metadataCoverage;
export type OlosConformanceAssertionId = MetadataAssertionId;
export type OlosConformanceCoverage = MetadataCoverage;
export type OlosConformanceCoverageStatus = MetadataCoverageStatus;
export type OlosConformanceLevel = MetadataLevel;

export interface AssertCoordinatorPipelineStoreConformanceOptions {
  createStore(): CoordinatorPipelineStore | Promise<CoordinatorPipelineStore>;
}

export async function assertCoordinatorPipelineStoreConformance(
  options: AssertCoordinatorPipelineStoreConformanceOptions
): Promise<void> {
  const store = await options.createStore();
  const initial = createCoordinatorPipeline({
    pathways: conformancePathways,
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
  expectStoreDifferent(
    loaded.state.pathways,
    initial.pathways,
    "loaded pathways must not reuse the saved pathways array"
  );

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
    deliveryUrl: "https://media.example.com/v1080/init.mp4",
    duration: 1,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: "init",
    maxBytes: 2048,
    mediaSequenceNumber: 0,
    objectKey: "media/v1080/init.mp4",
    publisherInstanceId: "pub_1",
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
  tenantId: "tenant_1",
};

const conformancePathways: Pathway[] = [
  {
    baseUrl: "https://media.example.com",
    pathwayId: "primary",
    priority: 0,
    providerId: "s3_primary",
    state: "active",
  },
];
