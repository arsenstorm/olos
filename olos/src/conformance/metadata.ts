export const OLOS_CONFORMANCE_ASSERTION_IDS = [
  "CORE-STORE-001",
  "CORE-STORE-002",
  "CORE-STORE-003",
  "CORE-STORE-004",
  "CORE-STORE-005",
  "CORE-STORE-006",
  "CORE-STORE-007",
  "CORE-STORE-008",
  "CORE-SCHEMA-001",
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
  "CORE-RUNTIME-019",
  "CORE-RUNTIME-020",
  "CORE-RUNTIME-021",
  "CORE-RUNTIME-022",
  "CORE-RUNTIME-023",
  "CORE-RUNTIME-024",
  "OBJ-LAYOUT-001",
  "OBJ-GRANT-001",
  "OBJ-GRANT-002",
  "OBJ-GRANT-003",
  "OBJ-GRANT-004",
  "OBJ-GRANT-005",
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
  "OBJ-RUNTIME-008",
  "OBJ-RUNTIME-009",
  "OBJ-RUNTIME-010",
  "OBJ-RUNTIME-011",
  "OBJ-RUNTIME-012",
  "OBJ-RUNTIME-013",
  "OBJ-RUNTIME-014",
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
  "HLS-GOLDEN-009",
  "HLS-GOLDEN-010",
  "HLS-HOLDBACK-001",
  "HLS-BLOCK-001",
  "HLS-BLOCK-002",
  "HLS-BLOCK-003",
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

const OLOS_CONFORMANCE_ASSERTION_ID_SET = new Set<string>(
  OLOS_CONFORMANCE_ASSERTION_IDS
);

function defineConformanceCoverage<
  const T extends readonly OlosConformanceCoverage[],
>(coverage: T): T {
  const mapped = new Set<string>();

  for (const entry of coverage) {
    if (!OLOS_CONFORMANCE_ASSERTION_ID_SET.has(entry.id)) {
      throw new Error(`unknown conformance assertion coverage id: ${entry.id}`);
    }

    if (mapped.has(entry.id)) {
      throw new Error(
        `duplicate conformance assertion coverage id: ${entry.id}`
      );
    }

    mapped.add(entry.id);
  }

  const missing = OLOS_CONFORMANCE_ASSERTION_IDS.filter(
    (id) => !mapped.has(id)
  );

  if (missing.length > 0) {
    throw new Error(
      `missing conformance assertion coverage ids: ${missing.join(", ")}`
    );
  }

  return coverage;
}

export const OLOS_CONFORMANCE_COVERAGE = defineConformanceCoverage([
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
    id: "CORE-SCHEMA-001",
    level: "core",
    status: "covered",
    testFile: "src/schema.test.ts",
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
    id: "CORE-RUNTIME-019",
    level: "core",
    status: "covered",
    testFile: "e2e/runtime-client-flow.test.ts",
  },
  {
    id: "CORE-RUNTIME-020",
    level: "core",
    status: "covered",
    testFile: "src/runtime/slot.test.ts",
  },
  {
    id: "CORE-RUNTIME-021",
    level: "core",
    status: "covered",
    testFile: "src/runtime/commit.test.ts",
  },
  {
    id: "CORE-RUNTIME-022",
    level: "core",
    status: "covered",
    testFile: "src/runtime/http.test.ts",
  },
  {
    id: "CORE-RUNTIME-023",
    level: "core",
    status: "covered",
    testFile: "src/runtime/http.test.ts",
  },
  {
    id: "CORE-RUNTIME-024",
    level: "core",
    status: "covered",
    testFile: "src/runtime/http.test.ts",
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
    id: "OBJ-GRANT-005",
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
    testFile: "e2e/s3-http-pipeline.test.ts",
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
    testFile: "src/s3/http.test.ts",
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
    testFile: "src/s3/http.test.ts",
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
    testFile: "src/s3/http.test.ts",
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
    testFile: "e2e/s3-http-pipeline.test.ts",
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
    id: "OBJ-RUNTIME-008",
    level: "object",
    status: "covered",
    testFile: "e2e/s3-http-pipeline.test.ts",
  },
  {
    id: "OBJ-RUNTIME-009",
    level: "object",
    status: "covered",
    testFile: "e2e/s3-http-pipeline.test.ts",
  },
  {
    id: "OBJ-RUNTIME-010",
    level: "object",
    status: "covered",
    testFile: "src/s3/http.test.ts",
  },
  {
    id: "OBJ-RUNTIME-011",
    level: "object",
    status: "covered",
    testFile: "src/s3/http.test.ts",
  },
  {
    id: "OBJ-RUNTIME-012",
    level: "object",
    status: "covered",
    testFile: "src/s3/http.test.ts",
  },
  {
    id: "OBJ-RUNTIME-013",
    level: "object",
    status: "covered",
    testFile: "src/s3/http.test.ts",
  },
  {
    id: "OBJ-RUNTIME-014",
    level: "object",
    status: "covered",
    testFile: "e2e/s3-http-pipeline.test.ts",
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
    testFile: "src/state/direct-public-security-policy.test.ts",
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
    testFile: "src/state/direct-public-security-policy.test.ts",
  },
  {
    id: "OBJ-CACHE-005",
    level: "object",
    status: "covered",
    testFile: "src/state/direct-public-security-policy.test.ts",
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
    id: "HLS-GOLDEN-009",
    level: "hls",
    status: "covered",
    testFile: "src/hls/master-playlist.test.ts",
  },
  {
    id: "HLS-GOLDEN-010",
    level: "hls",
    status: "covered",
    testFile: "src/hls/media-playlist.test.ts",
  },
  {
    id: "HLS-HOLDBACK-001",
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
    id: "HLS-BLOCK-003",
    level: "hls",
    status: "covered",
    testFile: "e2e/runtime-client-flow.test.ts",
  },
  {
    id: "SEC-DIRECT-004",
    level: "security",
    status: "covered",
    testFile: "src/s3/http.test.ts",
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
    testFile: "src/validation/upload-slot.test.ts",
  },
  {
    id: "SEC-DIRECT-003",
    level: "security",
    status: "covered",
    testFile: "src/s3/http.test.ts",
  },
  {
    id: "SEC-DIRECT-005",
    level: "security",
    status: "covered",
    testFile: "src/validation/upload-slot.test.ts",
  },
  {
    id: "SEC-DIRECT-006",
    level: "security",
    status: "covered",
    testFile: "src/s3/http.test.ts",
  },
  {
    id: "SEC-DIRECT-007",
    level: "security",
    status: "covered",
    testFile: "src/s3/http.test.ts",
  },
] as const satisfies readonly OlosConformanceCoverage[]);

const OLOS_CONFORMANCE_COVERAGE_BY_ID = new Map<
  OlosConformanceAssertionId,
  OlosConformanceCoverage
>(
  OLOS_CONFORMANCE_COVERAGE.map((entry) => [
    entry.id,
    entry satisfies OlosConformanceCoverage,
  ])
);

export function getOlosConformanceCoverage(
  id: OlosConformanceAssertionId
): OlosConformanceCoverage | undefined {
  return OLOS_CONFORMANCE_COVERAGE_BY_ID.get(id);
}

export function isOlosConformanceAssertionId(
  value: string
): value is OlosConformanceAssertionId {
  return OLOS_CONFORMANCE_ASSERTION_ID_SET.has(value);
}
