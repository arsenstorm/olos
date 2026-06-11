export const OLOS_CONFORMANCE_ASSERTION_IDS = [
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
  "OBJ-GRANT-001",
  "OBJ-GRANT-002",
  "OBJ-GRANT-003",
  "OBJ-GRANT-004",
  "OBJ-HEAD-001",
  "OBJ-PUB-001",
  "OBJ-PUB-002",
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

export const OLOS_CONFORMANCE_COVERAGE = [
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
    testFile: "src/state/upload-slot.test.ts",
  },
  {
    id: "CORE-SLOT-007",
    level: "core",
    status: "covered",
    testFile: "src/state/pathway.test.ts",
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
    id: "CORE-EVENT-001",
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
    id: "OBJ-GRANT-001",
    level: "object",
    status: "covered",
    testFile: "src/s3/upload-grant.test.ts",
  },
  {
    id: "OBJ-HEAD-001",
    level: "object",
    status: "covered",
    testFile: "src/state/observed-upload.test.ts",
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
    id: "SEC-DIRECT-004",
    level: "security",
    status: "covered",
    testFile: "src/hls/media-playlist.test.ts",
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
