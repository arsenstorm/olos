import {
  type CoordinatorPipelineStore,
  type CoordinatorStoreSave,
  createCoordinatorPipeline,
  issueCoordinatorSlot,
} from "./protocol/coordinator";
import type { Pathway } from "./types/pathway";
import type { Session } from "./types/session";

export const OLOS_CONFORMANCE_ASSERTION_IDS = [
  "CORE-STORE-001",
  "CORE-STORE-002",
  "CORE-STORE-003",
  "CORE-STORE-004",
  "CORE-STORE-005",
  "CORE-STORE-006",
  "CORE-STORE-007",
  "CORE-STORE-008",
  "CORE-SLOT-001",
  "CORE-SLOT-002",
  "CORE-SLOT-003",
  "CORE-SLOT-004",
  "CORE-SLOT-005",
  "CORE-SLOT-006",
  "CORE-SLOT-007",
  "CORE-COMMIT-001",
  "CORE-COMMIT-002",
  "CORE-COMMIT-003",
  "CORE-COMMIT-004",
  "CORE-COMMIT-005",
  "CORE-COMMIT-006",
  "CORE-COMMIT-007",
  "CORE-COMMIT-008",
  "CORE-LATE-001",
  "CORE-LATE-002",
  "CORE-EVENT-001",
  "CORE-EVENT-002",
  "CORE-EVENT-003",
  "CORE-EVENT-004",
  "CORE-EVENT-005",
  "CORE-WINDOW-001",
  "CORE-WINDOW-002",
  "CORE-WINDOW-003",
  "CORE-WINDOW-004",
  "CORE-WINDOW-005",
  "CORE-WINDOW-006",
  "CORE-WINDOW-007",
  "CORE-RUNTIME-001",
  "CORE-RUNTIME-002",
  "CORE-RUNTIME-003",
  "CORE-RUNTIME-004",
  "CORE-RUNTIME-005",
  "CORE-RUNTIME-006",
  "CORE-RUNTIME-007",
  "CORE-RUNTIME-008",
  "CORE-RUNTIME-009",
  "CORE-RUNTIME-010",
  "CORE-RUNTIME-011",
  "CORE-RUNTIME-012",
  "CORE-RUNTIME-013",
  "CORE-RUNTIME-014",
  "CORE-RUNTIME-015",
  "CORE-RUNTIME-016",
  "CORE-RUNTIME-017",
  "CORE-RUNTIME-018",
  "OBJ-LAYOUT-001",
  "OBJ-GRANT-001",
  "OBJ-GRANT-002",
  "OBJ-GRANT-003",
  "OBJ-GRANT-004",
  "OBJ-HEAD-001",
  "OBJ-PUB-001",
  "OBJ-PUB-002",
  "OBJ-FLOW-001",
  "OBJ-FLOW-002",
  "OBJ-FLOW-003",
  "OBJ-FLOW-004",
  "OBJ-FLOW-005",
  "OBJ-FLOW-006",
  "OBJ-FLOW-007",
  "OBJ-FLOW-008",
  "OBJ-FLOW-009",
  "OBJ-FLOW-010",
  "OBJ-FLOW-011",
  "OBJ-FLOW-012",
  "OBJ-FLOW-013",
  "OBJ-RUNTIME-001",
  "OBJ-RUNTIME-002",
  "OBJ-RUNTIME-003",
  "OBJ-RUNTIME-004",
  "OBJ-RUNTIME-005",
  "OBJ-RUNTIME-006",
  "OBJ-RUNTIME-007",
  "OBJ-CACHE-001",
  "OBJ-CACHE-002",
  "OBJ-CACHE-003",
  "OBJ-CACHE-004",
  "OBJ-CACHE-005",
  "HLS-GOLDEN-001",
  "HLS-GOLDEN-002",
  "HLS-GOLDEN-003",
  "HLS-GOLDEN-004",
  "HLS-GOLDEN-005",
  "HLS-GOLDEN-006",
  "HLS-GOLDEN-007",
  "HLS-GOLDEN-008",
  "HLS-BLOCK-001",
  "HLS-BLOCK-002",
  "SEC-DIRECT-001",
  "SEC-DIRECT-002",
  "SEC-DIRECT-003",
  "SEC-DIRECT-004",
  "SEC-DIRECT-005",
  "SEC-DIRECT-006",
  "SEC-DIRECT-007",
] as const;

export type OlosConformanceAssertionId =
  (typeof OLOS_CONFORMANCE_ASSERTION_IDS)[number];

export type OlosConformanceLevel = "core" | "hls" | "object" | "security";
export type OlosConformanceCoverageStatus = "covered" | "partial";

export interface OlosConformanceCoverage {
  id: OlosConformanceAssertionId;
  level: OlosConformanceLevel;
  status: OlosConformanceCoverageStatus;
  testFile: string;
}

export interface AssertCoordinatorPipelineStoreConformanceOptions {
  createStore(): CoordinatorPipelineStore | Promise<CoordinatorPipelineStore>;
}

export const OLOS_CONFORMANCE_COVERAGE = [
  {
    id: "CORE-STORE-001",
    level: "core",
    status: "covered",
    testFile: "src/conformance.test.ts",
  },
  {
    id: "CORE-STORE-002",
    level: "core",
    status: "covered",
    testFile: "src/conformance.test.ts",
  },
  {
    id: "CORE-STORE-003",
    level: "core",
    status: "covered",
    testFile: "src/conformance.test.ts",
  },
  {
    id: "CORE-STORE-004",
    level: "core",
    status: "covered",
    testFile: "src/conformance.test.ts",
  },
  {
    id: "CORE-STORE-005",
    level: "core",
    status: "covered",
    testFile: "src/conformance.test.ts",
  },
  {
    id: "CORE-STORE-006",
    level: "core",
    status: "covered",
    testFile: "src/protocol/serialized-store.test.ts",
  },
  {
    id: "CORE-STORE-007",
    level: "core",
    status: "covered",
    testFile: "src/protocol/serialized-store.test.ts",
  },
  {
    id: "CORE-STORE-008",
    level: "core",
    status: "covered",
    testFile: "src/protocol/sqlite-store.test.ts",
  },
  {
    id: "CORE-SLOT-001",
    level: "core",
    status: "covered",
    testFile: "src/state/upload-slot.test.ts",
  },
  {
    id: "CORE-SLOT-002",
    level: "core",
    status: "covered",
    testFile: "src/state/upload-slot.test.ts",
  },
  {
    id: "CORE-SLOT-003",
    level: "core",
    status: "covered",
    testFile: "src/state/commit.test.ts",
  },
  {
    id: "CORE-SLOT-004",
    level: "core",
    status: "covered",
    testFile: "src/state/upload-slot.test.ts",
  },
  {
    id: "CORE-SLOT-005",
    level: "core",
    status: "covered",
    testFile: "src/state/upload-slot.test.ts",
  },
  {
    id: "CORE-SLOT-006",
    level: "core",
    status: "covered",
    testFile: "src/protocol/coordinator.test.ts",
  },
  {
    id: "CORE-SLOT-007",
    level: "core",
    status: "covered",
    testFile: "src/protocol/coordinator.test.ts",
  },
  {
    id: "CORE-COMMIT-001",
    level: "core",
    status: "covered",
    testFile: "src/state/commit.test.ts",
  },
  {
    id: "CORE-COMMIT-002",
    level: "core",
    status: "covered",
    testFile: "src/state/commit.test.ts",
  },
  {
    id: "CORE-COMMIT-003",
    level: "core",
    status: "covered",
    testFile: "src/state/commit.test.ts",
  },
  {
    id: "CORE-COMMIT-004",
    level: "core",
    status: "covered",
    testFile: "src/state/commit.test.ts",
  },
  {
    id: "CORE-COMMIT-005",
    level: "core",
    status: "covered",
    testFile: "src/state/commit.test.ts",
  },
  {
    id: "CORE-COMMIT-006",
    level: "core",
    status: "covered",
    testFile: "src/state/commit.test.ts",
  },
  {
    id: "CORE-COMMIT-007",
    level: "core",
    status: "covered",
    testFile: "src/state/commit.test.ts",
  },
  {
    id: "CORE-COMMIT-008",
    level: "core",
    status: "covered",
    testFile: "src/state/committed-window.test.ts",
  },
  {
    id: "CORE-LATE-001",
    level: "core",
    status: "covered",
    testFile: "src/state/commit.test.ts",
  },
  {
    id: "CORE-LATE-002",
    level: "core",
    status: "covered",
    testFile: "src/state/commit.test.ts",
  },
  {
    id: "CORE-EVENT-001",
    level: "core",
    status: "covered",
    testFile: "src/state/observed-upload.test.ts",
  },
  {
    id: "CORE-EVENT-002",
    level: "core",
    status: "covered",
    testFile: "src/state/observed-upload.test.ts",
  },
  {
    id: "CORE-EVENT-003",
    level: "core",
    status: "covered",
    testFile: "src/state/observed-upload.test.ts",
  },
  {
    id: "CORE-EVENT-004",
    level: "core",
    status: "covered",
    testFile: "src/state/observed-upload.test.ts",
  },
  {
    id: "CORE-EVENT-005",
    level: "core",
    status: "covered",
    testFile: "src/state/observed-upload.test.ts",
  },
  {
    id: "CORE-WINDOW-001",
    level: "core",
    status: "covered",
    testFile: "src/state/cursor.test.ts",
  },
  {
    id: "CORE-WINDOW-002",
    level: "core",
    status: "covered",
    testFile: "src/hls/media-playlist.test.ts",
  },
  {
    id: "CORE-WINDOW-003",
    level: "core",
    status: "covered",
    testFile: "src/validation/committed-window.test.ts",
  },
  {
    id: "CORE-WINDOW-004",
    level: "core",
    status: "covered",
    testFile: "src/validation/committed-window.test.ts",
  },
  {
    id: "CORE-WINDOW-005",
    level: "core",
    status: "covered",
    testFile: "src/validation/committed-window.test.ts",
  },
  {
    id: "CORE-WINDOW-006",
    level: "core",
    status: "covered",
    testFile: "src/hls/media-playlist.test.ts",
  },
  {
    id: "CORE-WINDOW-007",
    level: "core",
    status: "covered",
    testFile: "src/state/committed-window.test.ts",
  },
  {
    id: "CORE-RUNTIME-001",
    level: "core",
    status: "covered",
    testFile: "e2e/runtime-pipeline.test.ts",
  },
  {
    id: "CORE-RUNTIME-002",
    level: "core",
    status: "covered",
    testFile: "e2e/runtime-pipeline.test.ts",
  },
  {
    id: "CORE-RUNTIME-003",
    level: "core",
    status: "covered",
    testFile: "e2e/runtime-pipeline.test.ts",
  },
  {
    id: "CORE-RUNTIME-004",
    level: "core",
    status: "covered",
    testFile: "src/runtime/http.test.ts",
  },
  {
    id: "CORE-RUNTIME-005",
    level: "core",
    status: "covered",
    testFile: "src/runtime/http.test.ts",
  },
  {
    id: "CORE-RUNTIME-006",
    level: "core",
    status: "covered",
    testFile: "src/runtime/retention.test.ts",
  },
  {
    id: "CORE-RUNTIME-007",
    level: "core",
    status: "covered",
    testFile: "src/runtime/publisher.test.ts",
  },
  {
    id: "CORE-RUNTIME-008",
    level: "core",
    status: "covered",
    testFile: "src/runtime/publisher-lease.test.ts",
  },
  {
    id: "CORE-RUNTIME-009",
    level: "core",
    status: "covered",
    testFile: "src/runtime/publisher-plan.test.ts",
  },
  {
    id: "CORE-RUNTIME-010",
    level: "core",
    status: "covered",
    testFile: "src/runtime/publisher-expiry.test.ts",
  },
  {
    id: "CORE-RUNTIME-011",
    level: "core",
    status: "covered",
    testFile: "src/runtime/health.test.ts",
  },
  {
    id: "CORE-RUNTIME-012",
    level: "core",
    status: "covered",
    testFile: "src/runtime/latency-profile.test.ts",
  },
  {
    id: "CORE-RUNTIME-013",
    level: "core",
    status: "covered",
    testFile: "src/runtime/publisher-cadence.test.ts",
  },
  {
    id: "CORE-RUNTIME-014",
    level: "core",
    status: "covered",
    testFile: "src/runtime/publisher-cadence.test.ts",
  },
  {
    id: "CORE-RUNTIME-015",
    level: "core",
    status: "covered",
    testFile: "src/runtime/publisher.test.ts",
  },
  {
    id: "CORE-RUNTIME-016",
    level: "core",
    status: "covered",
    testFile: "src/runtime/session.test.ts",
  },
  {
    id: "CORE-RUNTIME-017",
    level: "core",
    status: "covered",
    testFile: "src/runtime/http.test.ts",
  },
  {
    id: "CORE-RUNTIME-018",
    level: "core",
    status: "covered",
    testFile: "src/runtime/client.test.ts",
  },
  {
    id: "OBJ-LAYOUT-001",
    level: "object",
    status: "covered",
    testFile: "src/runtime/publisher-plan.test.ts",
  },
  {
    id: "OBJ-GRANT-001",
    level: "object",
    status: "covered",
    testFile: "src/s3/upload-grant.test.ts",
  },
  {
    id: "OBJ-GRANT-002",
    level: "object",
    status: "covered",
    testFile: "src/s3/upload-grant.test.ts",
  },
  {
    id: "OBJ-GRANT-003",
    level: "object",
    status: "covered",
    testFile: "src/s3/coordinator.test.ts",
  },
  {
    id: "OBJ-GRANT-004",
    level: "object",
    status: "covered",
    testFile: "src/state/provider-upload-grant-policy.test.ts",
  },
  {
    id: "OBJ-HEAD-001",
    level: "object",
    status: "covered",
    testFile: "src/state/observed-upload.test.ts",
  },
  {
    id: "OBJ-PUB-001",
    level: "object",
    status: "covered",
    testFile: "src/state/publication.test.ts",
  },
  {
    id: "OBJ-PUB-002",
    level: "object",
    status: "covered",
    testFile: "src/state/publication.test.ts",
  },
  {
    id: "OBJ-FLOW-001",
    level: "object",
    status: "covered",
    testFile: "e2e/object-store-flow.test.ts",
  },
  {
    id: "OBJ-FLOW-002",
    level: "object",
    status: "covered",
    testFile: "e2e/object-store-flow.test.ts",
  },
  {
    id: "OBJ-FLOW-003",
    level: "object",
    status: "covered",
    testFile: "e2e/object-store-flow.test.ts",
  },
  {
    id: "OBJ-FLOW-004",
    level: "object",
    status: "covered",
    testFile: "src/s3/publisher.test.ts",
  },
  {
    id: "OBJ-FLOW-005",
    level: "object",
    status: "covered",
    testFile: "src/s3/reconciliation.test.ts",
  },
  {
    id: "OBJ-FLOW-006",
    level: "object",
    status: "covered",
    testFile: "src/s3/publisher.test.ts",
  },
  {
    id: "OBJ-FLOW-007",
    level: "object",
    status: "covered",
    testFile: "src/s3/publisher.test.ts",
  },
  {
    id: "OBJ-FLOW-008",
    level: "object",
    status: "covered",
    testFile: "src/s3/reconciliation.test.ts",
  },
  {
    id: "OBJ-FLOW-009",
    level: "object",
    status: "covered",
    testFile: "src/s3/publisher.test.ts",
  },
  {
    id: "OBJ-FLOW-010",
    level: "object",
    status: "covered",
    testFile: "src/s3/retention.test.ts",
  },
  {
    id: "OBJ-FLOW-011",
    level: "object",
    status: "covered",
    testFile: "e2e/runtime-pipeline.test.ts",
  },
  {
    id: "OBJ-FLOW-012",
    level: "object",
    status: "covered",
    testFile: "src/s3/publisher.test.ts",
  },
  {
    id: "OBJ-FLOW-013",
    level: "object",
    status: "covered",
    testFile: "e2e/object-store-flow.test.ts",
  },
  {
    id: "OBJ-RUNTIME-001",
    level: "object",
    status: "covered",
    testFile: "src/s3/http.test.ts",
  },
  {
    id: "OBJ-RUNTIME-002",
    level: "object",
    status: "covered",
    testFile: "src/s3/http.test.ts",
  },
  {
    id: "OBJ-RUNTIME-003",
    level: "object",
    status: "covered",
    testFile: "src/s3/http.test.ts",
  },
  {
    id: "OBJ-RUNTIME-004",
    level: "object",
    status: "covered",
    testFile: "src/s3/http.test.ts",
  },
  {
    id: "OBJ-RUNTIME-005",
    level: "object",
    status: "covered",
    testFile: "src/s3/http.test.ts",
  },
  {
    id: "OBJ-RUNTIME-006",
    level: "object",
    status: "covered",
    testFile: "src/s3/http.test.ts",
  },
  {
    id: "OBJ-RUNTIME-007",
    level: "object",
    status: "covered",
    testFile: "src/s3/http.test.ts",
  },
  {
    id: "OBJ-CACHE-001",
    level: "object",
    status: "covered",
    testFile: "src/state/cache-policy.test.ts",
  },
  {
    id: "OBJ-CACHE-002",
    level: "object",
    status: "covered",
    testFile: "src/state/cache-policy.test.ts",
  },
  {
    id: "OBJ-CACHE-003",
    level: "object",
    status: "covered",
    testFile: "src/state/cache-policy.test.ts",
  },
  {
    id: "OBJ-CACHE-004",
    level: "object",
    status: "covered",
    testFile: "src/state/cache-policy.test.ts",
  },
  {
    id: "OBJ-CACHE-005",
    level: "object",
    status: "covered",
    testFile: "src/state/cache-policy.test.ts",
  },
  {
    id: "HLS-GOLDEN-001",
    level: "hls",
    status: "covered",
    testFile: "src/hls/master-playlist.test.ts",
  },
  {
    id: "HLS-GOLDEN-002",
    level: "hls",
    status: "covered",
    testFile: "src/hls/media-playlist.test.ts",
  },
  {
    id: "HLS-GOLDEN-003",
    level: "hls",
    status: "covered",
    testFile: "src/hls/media-playlist.test.ts",
  },
  {
    id: "HLS-GOLDEN-004",
    level: "hls",
    status: "covered",
    testFile: "src/hls/media-playlist.test.ts",
  },
  {
    id: "HLS-GOLDEN-005",
    level: "hls",
    status: "covered",
    testFile: "src/hls/media-playlist.test.ts",
  },
  {
    id: "HLS-GOLDEN-006",
    level: "hls",
    status: "covered",
    testFile: "src/hls/media-playlist.test.ts",
  },
  {
    id: "HLS-GOLDEN-007",
    level: "hls",
    status: "covered",
    testFile: "src/hls/media-playlist.test.ts",
  },
  {
    id: "HLS-GOLDEN-008",
    level: "hls",
    status: "covered",
    testFile: "src/hls/media-playlist.test.ts",
  },
  {
    id: "HLS-BLOCK-001",
    level: "hls",
    status: "covered",
    testFile: "src/hls/blocking-reload.test.ts",
  },
  {
    id: "HLS-BLOCK-002",
    level: "hls",
    status: "covered",
    testFile: "src/hls/manifest-artifacts.test.ts",
  },
  {
    id: "SEC-DIRECT-004",
    level: "security",
    status: "covered",
    testFile: "src/hls/media-playlist.test.ts",
  },
  {
    id: "SEC-DIRECT-001",
    level: "security",
    status: "covered",
    testFile: "src/state/direct-public-security-policy.test.ts",
  },
  {
    id: "SEC-DIRECT-002",
    level: "security",
    status: "covered",
    testFile: "src/state/direct-public-security-policy.test.ts",
  },
  {
    id: "SEC-DIRECT-003",
    level: "security",
    status: "covered",
    testFile: "src/state/direct-public-security-policy.test.ts",
  },
  {
    id: "SEC-DIRECT-005",
    level: "security",
    status: "covered",
    testFile: "src/state/direct-public-security-policy.test.ts",
  },
  {
    id: "SEC-DIRECT-006",
    level: "security",
    status: "covered",
    testFile: "src/s3/coordinator.test.ts",
  },
  {
    id: "SEC-DIRECT-007",
    level: "security",
    status: "covered",
    testFile: "src/protocol/coordinator.test.ts",
  },
] as const satisfies readonly OlosConformanceCoverage[];

export function getOlosConformanceCoverage(
  id: OlosConformanceAssertionId
): OlosConformanceCoverage | undefined {
  return OLOS_CONFORMANCE_COVERAGE.find((entry) => entry.id === id);
}

export function isOlosConformanceAssertionId(
  value: string
): value is OlosConformanceAssertionId {
  return OLOS_CONFORMANCE_ASSERTION_IDS.includes(
    value as OlosConformanceAssertionId
  );
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
    publicationMode: "direct-public",
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
