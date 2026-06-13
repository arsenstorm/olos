import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export const expectedRuntimeExports = {
  olos: [
    "OLOS_PROTOCOL_NAME",
    "OLOS_PROTOCOL_SHORT_NAME",
    "OLOS_SPEC_STATUS",
    "OLOS_WIRE_VERSION",
  ],
  "olos/config": ["OLOS_ERROR_CODES", "SESSION_STATES", "UPLOAD_SLOT_STATES"],
  "olos/conformance": [
    "OLOS_CONFORMANCE_ASSERTION_IDS",
    "OLOS_CONFORMANCE_COVERAGE",
  ],
  "olos/hls": [
    "createHlsManifestArtifactResponse",
    "createHlsManifestErrorWebResponse",
    "createHlsManifestWebResponse",
    "parseHlsBlockingReloadRequest",
    "renderMediaPlaylist",
    "resolveBlockingHlsManifestArtifactResponse",
    "resolveHlsBlockingReload",
    "resolveHlsManifestArtifactResponse",
    "waitForHlsBlockingReload",
  ],
  "olos/protocol": [
    "assertSerializedCoordinatorStoreBackendConformance",
    "createCoordinatorPipeline",
    "createMemoryCoordinatorStore",
    "createSerializedCoordinatorStore",
  ],
  "olos/runtime": [
    "commitStoredCoordinatorUploadFromRequest",
    "commitRuntimeUpload",
    "createMemoryRuntimeCursorNotifier",
    "createRuntimeObjectLowLatencyManifestOptions",
    "createRuntimeObjectLowLatencyProfile",
    "createRuntimeObjectLowLatencyPublisherDefaults",
    "createRuntimeObjectLowLatencyPublisherOptions",
    "createRuntimePublisherLease",
    "createRuntimePublisherNextObjectPlan",
    "createRuntimePublisherObjectKeyNonce",
    "createRuntimePublisherObjectPlan",
    "createRuntimePublisherObjectPlanInput",
    "createRuntimeSession",
    "createStoredCoordinatorSession",
    "createStoredCoordinatorRuntimeHandler",
    "deleteRetiredCoordinatorObjects",
    "getRuntimeMasterPlaylist",
    "getRuntimeMediaPlaylist",
    "getRuntimeSessionHealth",
    "getRuntimeSessionRetentionPlan",
    "issueStoredCoordinatorSlotFromRequest",
    "issueRuntimeSlot",
    "planStoredCoordinatorRetention",
    "resolveRuntimeLiveHealth",
    "resolveRuntimePublisherLeaseStatus",
    "resolveRuntimePublisherLoopDecision",
    "resolveRuntimePublisherNextObjectPosition",
    "resolveRuntimePublisherObjectExpiry",
    "refreshRuntimePublisherLease",
    "runRuntimePublisherUploadStep",
    "RuntimeHttpError",
    "sendRuntimePublisherHeartbeat",
    "serveStoredBlockingCoordinatorManifest",
    "serveStoredCoordinatorManifest",
    "transitionStoredCoordinatorSession",
    "transitionRuntimeSession",
  ],
  "olos/schema": [
    "OLOS_COMMIT_SCHEMA",
    "OLOS_CURSOR_SCHEMA",
    "OLOS_ERROR_SCHEMA",
    "OLOS_JSON_SCHEMAS",
    "OLOS_MEDIA_OBJECT_SCHEMA",
    "OLOS_PROVIDER_CAPABILITY_SCHEMA",
    "OLOS_SESSION_SCHEMA",
    "OLOS_UPLOAD_GRANT_SCHEMA",
    "OLOS_UPLOAD_SLOT_SCHEMA",
  ],
  "olos/s3": [
    "createPresignedS3UploadGrant",
    "createS3UploadGrant",
    "createObservedUploadFromS3HeadObject",
    "createStoredS3CoordinatorRuntimeHandler",
    "deleteRetiredS3CoordinatorObjects",
    "issueStoredS3CoordinatorUploadGrant",
    "normalizeS3ObjectCreatedEvents",
    "observeS3Object",
    "planStoredS3CoordinatorReconciliation",
    "reconcileStoredS3CoordinatorUploads",
    "routeStoredS3CoordinatorUploadEvent",
    "runNextStoredS3PublisherUploadStep",
  ],
  "olos/state": [
    "createCursor",
    "createPublicationKillSwitch",
    "resolvePublicationControl",
  ],
  "olos/types": [],
  "olos/validation": ["assertSession", "isSession", "isUploadSlot"],
} as const;

const exactRuntimeExports = {
  olos: expectedRuntimeExports.olos,
  "olos/types": [],
} as const;

export async function writePackageSmokeFile(root: string): Promise<void> {
  await writeFile(join(root, "smoke.mjs"), packageSmokeSource());
  await writeFile(join(root, "smoke.ts"), packageTypeSmokeSource());
  await writeFile(join(root, "tsconfig.json"), packageTypeSmokeConfig());
}

function packageSmokeSource(): string {
  return `
import { readFile } from "node:fs/promises";

const expectedRuntimeExports = ${JSON.stringify(expectedRuntimeExports)};
const exactRuntimeExports = ${JSON.stringify(exactRuntimeExports)};
const packageJson = JSON.parse(
  await readFile(new URL("./node_modules/olos/package.json", import.meta.url))
);
const exportedSubpaths = Object.keys(packageJson.exports)
  .filter((subpath) => subpath !== "./package.json")
  .map((subpath) => (subpath === "." ? "olos" : \`olos/\${subpath.slice(2)}\`));
const expectedSubpaths = Object.keys(expectedRuntimeExports);

assertList("exported subpaths", exportedSubpaths, expectedSubpaths);

for (const [specifier, names] of Object.entries(expectedRuntimeExports)) {
  const module = await import(specifier);

  for (const name of names) {
    if (!(name in module)) {
      throw new Error(\`\${specifier} is missing \${name}\`);
    }
  }

  if (specifier in exactRuntimeExports) {
    assertList(
      \`\${specifier} runtime exports\`,
      Object.keys(module),
      exactRuntimeExports[specifier]
    );
  }
}

function assertList(name, actual, expected) {
  const actualList = [...actual].sort();
  const expectedList = [...expected].sort();

  if (JSON.stringify(actualList) !== JSON.stringify(expectedList)) {
    throw new Error(
      \`\${name} mismatch: expected \${expectedList.join(", ")}, received \${actualList.join(", ")}\`
    );
  }
}
`.trimStart();
}

function packageTypeSmokeSource(): string {
  return `
import { OLOS_WIRE_VERSION } from "olos";
import {
  createHlsManifestArtifactResponse,
  createHlsManifestErrorWebResponse,
  createHlsManifestWebResponse,
  parseHlsBlockingReloadRequest,
  resolveBlockingHlsManifestArtifactResponse,
  resolveHlsBlockingReload,
  waitForHlsBlockingReload,
} from "olos/hls";
import {
  createMemoryRuntimeCursorNotifier,
  createRuntimeObjectLowLatencyManifestOptions,
  createRuntimeObjectLowLatencyProfile,
  createRuntimeObjectLowLatencyPublisherDefaults,
  createRuntimeObjectLowLatencyPublisherOptions,
  createRuntimePublisherLease,
  createRuntimePublisherNextObjectPlan,
  createRuntimePublisherObjectPlan,
  createRuntimePublisherObjectPlanInput,
  createStoredCoordinatorRuntimeHandler,
  refreshRuntimePublisherLease,
  resolveRuntimePublisherLeaseStatus,
  resolveRuntimePublisherLoopDecision,
  resolveRuntimePublisherNextObjectPosition,
  resolveRuntimePublisherObjectExpiry,
  serveStoredBlockingCoordinatorManifest,
  serveStoredCoordinatorManifest,
} from "olos/runtime";
import {
  createS3UploadGrant,
  createStoredS3CoordinatorRuntimeHandler,
  normalizeS3ObjectCreatedEvents,
  routeStoredS3CoordinatorUploadEvent,
} from "olos/s3";
import { OLOS_JSON_SCHEMAS } from "olos/schema";
import type {
  ProviderCapabilityDocument,
  Session,
  UploadGrant,
  UploadSlot,
} from "olos/types";
import { assertSession } from "olos/validation";

const profile = createRuntimeObjectLowLatencyProfile();
const manifestArtifactResponse: typeof createHlsManifestArtifactResponse =
  createHlsManifestArtifactResponse;
const manifestErrorResponse: typeof createHlsManifestErrorWebResponse =
  createHlsManifestErrorWebResponse;
const manifestWebResponse: typeof createHlsManifestWebResponse =
  createHlsManifestWebResponse;
const blockingReloadRequest: typeof parseHlsBlockingReloadRequest =
  parseHlsBlockingReloadRequest;
const blockingManifestResponse: typeof resolveBlockingHlsManifestArtifactResponse =
  resolveBlockingHlsManifestArtifactResponse;
const blockingReload: typeof resolveHlsBlockingReload =
  resolveHlsBlockingReload;
const blockingReloadWait: typeof waitForHlsBlockingReload =
  waitForHlsBlockingReload;
const runtimeHandler: typeof createStoredCoordinatorRuntimeHandler =
  createStoredCoordinatorRuntimeHandler;
const memoryNotifier: typeof createMemoryRuntimeCursorNotifier =
  createMemoryRuntimeCursorNotifier;
const manifestOptions: typeof createRuntimeObjectLowLatencyManifestOptions =
  createRuntimeObjectLowLatencyManifestOptions;
const publisherOptions: typeof createRuntimeObjectLowLatencyPublisherOptions =
  createRuntimeObjectLowLatencyPublisherOptions;
const publisherDefaults: typeof createRuntimeObjectLowLatencyPublisherDefaults =
  createRuntimeObjectLowLatencyPublisherDefaults;
const publisherLease: typeof createRuntimePublisherLease =
  createRuntimePublisherLease;
const refreshLease: typeof refreshRuntimePublisherLease =
  refreshRuntimePublisherLease;
const leaseStatus: typeof resolveRuntimePublisherLeaseStatus =
  resolveRuntimePublisherLeaseStatus;
const loopDecision: typeof resolveRuntimePublisherLoopDecision =
  resolveRuntimePublisherLoopDecision;
const nextPosition: typeof resolveRuntimePublisherNextObjectPosition =
  resolveRuntimePublisherNextObjectPosition;
const nextObjectPlan: typeof createRuntimePublisherNextObjectPlan =
  createRuntimePublisherNextObjectPlan;
const objectPlan: typeof createRuntimePublisherObjectPlan =
  createRuntimePublisherObjectPlan;
const objectPlanInput: typeof createRuntimePublisherObjectPlanInput =
  createRuntimePublisherObjectPlanInput;
const objectExpiry: typeof resolveRuntimePublisherObjectExpiry =
  resolveRuntimePublisherObjectExpiry;
const storedManifest: typeof serveStoredCoordinatorManifest =
  serveStoredCoordinatorManifest;
const storedBlockingManifest: typeof serveStoredBlockingCoordinatorManifest =
  serveStoredBlockingCoordinatorManifest;
const s3RuntimeHandler: typeof createStoredS3CoordinatorRuntimeHandler =
  createStoredS3CoordinatorRuntimeHandler;
const normalizeS3Events: typeof normalizeS3ObjectCreatedEvents =
  normalizeS3ObjectCreatedEvents;
const routeS3Event: typeof routeStoredS3CoordinatorUploadEvent =
  routeStoredS3CoordinatorUploadEvent;

const session: Session = {
  createdAt: "2026-01-01T00:00:00.000Z",
  epoch: 1,
  latencyProfile: profile.latencyProfile,
  olos: OLOS_WIRE_VERSION,
  partTarget: profile.partTarget,
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
  segmentTarget: profile.segmentTarget,
  sessionId: "session_1",
  state: "live",
  tenantId: "tenant_1",
};

assertSession(session);
OLOS_JSON_SCHEMAS.session.properties.olos.const satisfies "1.0";

const capability = {
  consistency: {
    headAfterCreate: "strong",
    readAfterCreate: "strong",
  },
  delivery: {
    negativeCachingPolicyDeclared: true,
    publicBaseUrl: "https://media.example.com",
  },
  kind: "object-store",
  olos: OLOS_WIRE_VERSION,
  providerId: "s3_primary",
  publication: {
    createIfAbsent: true,
    directObjectPublication: true,
  },
  uploadGrants: {
    exactKey: true,
    methodBound: true,
    objectSizeCanBeObserved: true,
    presignedPut: true,
  },
} satisfies ProviderCapabilityDocument;

capability.uploadGrants.objectSizeCanBeObserved satisfies true;

const slot: UploadSlot = {
  contentType: "video/mp4",
  deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
  duration: 2,
  epoch: session.epoch,
  expiresAt: "2026-01-01T00:00:05.000Z",
  kind: "segment",
  maxBytes: 100_000,
  mediaSequenceNumber: 3810,
  objectKey: "live/session/v1080/3810.m4s",
  publicationMode: "direct-public",
  publisherInstanceId: "publisher_1",
  renditionId: "v1080",
  sessionId: session.sessionId,
  slotId: "slot_3810",
  state: "issued",
  tenantId: session.tenantId,
};

const grant: UploadGrant = createS3UploadGrant({
  presignedUrl:
    "https://media.s3.example.com/live/session/v1080/3810.m4s?X-Amz-Signature=abc",
  slot,
});

if (!grant.requiredHeaders) {
  throw new Error("expected S3 grant headers");
}

grant.requiredHeaders["x-amz-meta-olos-slot-id"] satisfies string;
manifestArtifactResponse satisfies typeof createHlsManifestArtifactResponse;
manifestErrorResponse satisfies typeof createHlsManifestErrorWebResponse;
manifestWebResponse satisfies typeof createHlsManifestWebResponse;
blockingReloadRequest satisfies typeof parseHlsBlockingReloadRequest;
blockingManifestResponse satisfies typeof resolveBlockingHlsManifestArtifactResponse;
blockingReload satisfies typeof resolveHlsBlockingReload;
blockingReloadWait satisfies typeof waitForHlsBlockingReload;
runtimeHandler satisfies typeof createStoredCoordinatorRuntimeHandler;
memoryNotifier satisfies typeof createMemoryRuntimeCursorNotifier;
manifestOptions satisfies typeof createRuntimeObjectLowLatencyManifestOptions;
publisherOptions satisfies typeof createRuntimeObjectLowLatencyPublisherOptions;
publisherDefaults satisfies typeof createRuntimeObjectLowLatencyPublisherDefaults;
publisherLease satisfies typeof createRuntimePublisherLease;
refreshLease satisfies typeof refreshRuntimePublisherLease;
leaseStatus satisfies typeof resolveRuntimePublisherLeaseStatus;
loopDecision satisfies typeof resolveRuntimePublisherLoopDecision;
nextPosition satisfies typeof resolveRuntimePublisherNextObjectPosition;
nextObjectPlan satisfies typeof createRuntimePublisherNextObjectPlan;
objectPlan satisfies typeof createRuntimePublisherObjectPlan;
objectPlanInput satisfies typeof createRuntimePublisherObjectPlanInput;
objectExpiry satisfies typeof resolveRuntimePublisherObjectExpiry;
storedManifest satisfies typeof serveStoredCoordinatorManifest;
storedBlockingManifest satisfies typeof serveStoredBlockingCoordinatorManifest;
s3RuntimeHandler satisfies typeof createStoredS3CoordinatorRuntimeHandler;
normalizeS3Events satisfies typeof normalizeS3ObjectCreatedEvents;
routeS3Event satisfies typeof routeStoredS3CoordinatorUploadEvent;
`.trimStart();
}

function packageTypeSmokeConfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        strict: true,
        target: "ES2022",
        types: ["node"],
      },
      include: ["smoke.ts"],
    },
    null,
    2
  )}\n`;
}
