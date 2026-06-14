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
    "createMemorySerializedCoordinatorStoreBackend",
    "createNextCoordinatorPipelineEtag",
    "createSerializedCoordinatorStore",
    "createSqliteSerializedCoordinatorStoreBackend",
    "createSqliteSerializedCoordinatorStoreSchema",
    "parseCoordinatorPipelineSnapshot",
    "planCoordinatorRetention",
    "serializeCoordinatorPipelineSnapshot",
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
    "summarizeRetiredCoordinatorObjectDeletions",
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
    "applyS3RuntimeRetention",
    "completeS3RuntimeUpload",
    "commitS3RuntimeUpload",
    "createPresignedS3UploadGrant",
    "createS3UploadGrant",
    "createObservedUploadFromS3HeadObject",
    "createStoredS3CoordinatorRuntimeHandler",
    "deleteRetiredS3CoordinatorObjects",
    "issueS3RuntimeUploadGrant",
    "issueStoredS3CoordinatorUploadGrant",
    "normalizeS3ObjectCreatedEvents",
    "observeS3Object",
    "planS3RuntimeReconciliation",
    "planStoredS3CoordinatorReconciliation",
    "reconcileS3RuntimeUploads",
    "reconcileStoredS3CoordinatorUploads",
    "routeStoredS3CoordinatorUploadEvent",
    "runNextStoredS3PublisherUploadStep",
    "runPlannedStoredS3PublisherUploadStep",
    "runStoredS3PublisherUploadStep",
    "summarizeStoredS3CoordinatorUploadReconciliation",
    "summarizeStoredS3PublisherUploadStep",
  ],
  "olos/state": [
    "createCursor",
    "createDirectPublicMediaResponseHeaders",
    "createDirectPublicNegativeObjectResponseHeaders",
    "createDirectPublicSecurityPolicy",
    "createPublicationKillSwitch",
    "resolveDirectPublicMediaRequestPolicy",
    "resolvePublicationControl",
    "selectExpiredUploadSlots",
    "selectRetiredCommittedObjects",
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
  assertSerializedCoordinatorStoreBackendConformance,
  createMemorySerializedCoordinatorStoreBackend,
  createNextCoordinatorPipelineEtag,
  createSerializedCoordinatorStore,
  createSqliteSerializedCoordinatorStoreBackend,
  createSqliteSerializedCoordinatorStoreSchema,
  parseCoordinatorPipelineSnapshot,
  planCoordinatorRetention,
  serializeCoordinatorPipelineSnapshot,
} from "olos/protocol";
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
  summarizeRetiredCoordinatorObjectDeletions,
} from "olos/runtime";
import type {
  CommitCoordinatorUploadFromRequestOptions,
  RunRuntimePublisherUploadStepOptions,
} from "olos/runtime";
import {
  applyS3RuntimeRetention,
  completeS3RuntimeUpload,
  commitS3RuntimeUpload,
  createObservedUploadFromS3HeadObject,
  createPresignedS3UploadGrant,
  createS3UploadGrant,
  createStoredS3CoordinatorRuntimeHandler,
  deleteRetiredS3CoordinatorObjects,
  issueS3RuntimeUploadGrant,
  issueStoredS3CoordinatorUploadGrant,
  normalizeS3ObjectCreatedEvents,
  observeS3Object,
  planS3RuntimeReconciliation,
  planStoredS3CoordinatorReconciliation,
  reconcileS3RuntimeUploads,
  reconcileStoredS3CoordinatorUploads,
  routeStoredS3CoordinatorUploadEvent,
  runPlannedStoredS3PublisherUploadStep,
  runStoredS3PublisherUploadStep,
  summarizeStoredS3CoordinatorUploadReconciliation,
  summarizeStoredS3PublisherUploadStep,
} from "olos/s3";
import type {
  S3RuntimeApplyRetentionOptions,
  S3RuntimeCommitPayload,
  S3RuntimeCommitUploadOptions,
  S3RuntimeCompleteUploadOptions,
  S3RuntimeCompletionHintPayload,
  S3RuntimeIssueUploadGrantOptions,
  S3RuntimePlanReconciliationOptions,
  S3RuntimeReconcileUploadsOptions,
  S3RuntimeReconciliationPayload,
  S3RuntimeReconciliationPlanPayload,
  S3RuntimeRetentionPayload,
  StoredS3CoordinatorCommitResponse,
  StoredS3CoordinatorEventRouteResponse,
  StoredS3CoordinatorReconciliationResponse,
  StoredS3CoordinatorRetentionResponse,
  StoredS3CoordinatorSlotGrantResponse,
  StoredS3PublisherUploadStepSummary,
  CreateStoredS3CoordinatorRuntimeHandlerOptions,
  ReconcileStoredS3CoordinatorUploadsOptions,
  RunPlannedStoredS3PublisherUploadStepOptions,
} from "olos/s3";
import { OLOS_JSON_SCHEMAS } from "olos/schema";
import {
  createDirectPublicMediaResponseHeaders,
  createDirectPublicNegativeObjectResponseHeaders,
  createDirectPublicSecurityPolicy,
  resolveDirectPublicMediaRequestPolicy,
  selectExpiredUploadSlots,
  selectRetiredCommittedObjects,
} from "olos/state";
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
const serializedStore: typeof createSerializedCoordinatorStore =
  createSerializedCoordinatorStore;
const memorySerializedBackend: typeof createMemorySerializedCoordinatorStoreBackend =
  createMemorySerializedCoordinatorStoreBackend;
const sqliteSerializedBackend: typeof createSqliteSerializedCoordinatorStoreBackend =
  createSqliteSerializedCoordinatorStoreBackend;
const sqliteSerializedSchema: typeof createSqliteSerializedCoordinatorStoreSchema =
  createSqliteSerializedCoordinatorStoreSchema;
const serializedBackendConformance: typeof assertSerializedCoordinatorStoreBackendConformance =
  assertSerializedCoordinatorStoreBackendConformance;
const nextEtag: typeof createNextCoordinatorPipelineEtag =
  createNextCoordinatorPipelineEtag;
const parseSnapshot: typeof parseCoordinatorPipelineSnapshot =
  parseCoordinatorPipelineSnapshot;
const serializeSnapshot: typeof serializeCoordinatorPipelineSnapshot =
  serializeCoordinatorPipelineSnapshot;
const retentionPlan: typeof planCoordinatorRetention =
  planCoordinatorRetention;
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
const deletionSummary: typeof summarizeRetiredCoordinatorObjectDeletions =
  summarizeRetiredCoordinatorObjectDeletions;
const directPublicPolicyFactory: typeof createDirectPublicSecurityPolicy =
  createDirectPublicSecurityPolicy;
const directPublicMediaHeaders: typeof createDirectPublicMediaResponseHeaders =
  createDirectPublicMediaResponseHeaders;
const directPublicNegativeHeaders: typeof createDirectPublicNegativeObjectResponseHeaders =
  createDirectPublicNegativeObjectResponseHeaders;
const directPublicRequestPolicy: typeof resolveDirectPublicMediaRequestPolicy =
  resolveDirectPublicMediaRequestPolicy;
const s3RuntimeHandler: typeof createStoredS3CoordinatorRuntimeHandler =
  createStoredS3CoordinatorRuntimeHandler;
const s3RuntimeGrantClient: typeof issueS3RuntimeUploadGrant =
  issueS3RuntimeUploadGrant;
const s3RuntimeCompletionClient: typeof completeS3RuntimeUpload =
  completeS3RuntimeUpload;
const s3RuntimeCommitClient: typeof commitS3RuntimeUpload =
  commitS3RuntimeUpload;
const s3RuntimeRetentionClient: typeof applyS3RuntimeRetention =
  applyS3RuntimeRetention;
const presignedS3Grant: typeof createPresignedS3UploadGrant =
  createPresignedS3UploadGrant;
const observedS3HeadObject: typeof createObservedUploadFromS3HeadObject =
  createObservedUploadFromS3HeadObject;
const observeS3: typeof observeS3Object = observeS3Object;
const issueS3Grant: typeof issueStoredS3CoordinatorUploadGrant =
  issueStoredS3CoordinatorUploadGrant;
const normalizeS3Events: typeof normalizeS3ObjectCreatedEvents =
  normalizeS3ObjectCreatedEvents;
const routeS3Event: typeof routeStoredS3CoordinatorUploadEvent =
  routeStoredS3CoordinatorUploadEvent;
const planS3RuntimeRecovery: typeof planS3RuntimeReconciliation =
  planS3RuntimeReconciliation;
const planS3Reconciliation: typeof planStoredS3CoordinatorReconciliation =
  planStoredS3CoordinatorReconciliation;
const reconcileS3RuntimeRecovery: typeof reconcileS3RuntimeUploads =
  reconcileS3RuntimeUploads;
const reconcileS3Uploads: typeof reconcileStoredS3CoordinatorUploads =
  reconcileStoredS3CoordinatorUploads;
const deleteS3Objects: typeof deleteRetiredS3CoordinatorObjects =
  deleteRetiredS3CoordinatorObjects;
const plannedS3PublisherStep: typeof runPlannedStoredS3PublisherUploadStep =
  runPlannedStoredS3PublisherUploadStep;
const rawS3PublisherStep: typeof runStoredS3PublisherUploadStep =
  runStoredS3PublisherUploadStep;
const s3ReconciliationSummary: typeof summarizeStoredS3CoordinatorUploadReconciliation =
  summarizeStoredS3CoordinatorUploadReconciliation;
const s3PublisherStepSummary: typeof summarizeStoredS3PublisherUploadStep =
  summarizeStoredS3PublisherUploadStep;
const expiredSlots: typeof selectExpiredUploadSlots =
  selectExpiredUploadSlots;
const retiredObjects: typeof selectRetiredCommittedObjects =
  selectRetiredCommittedObjects;
const runtimeCommitLateTolerance = {
  lateToleranceMs: 500,
} satisfies Pick<CommitCoordinatorUploadFromRequestOptions, "lateToleranceMs">;
const runtimePublisherLateTolerance = {
  lateToleranceMs: 500,
} satisfies Pick<RunRuntimePublisherUploadStepOptions, "lateToleranceMs">;
const s3RuntimeLateTolerance = {
  lateToleranceMs: 500,
} satisfies Pick<CreateStoredS3CoordinatorRuntimeHandlerOptions, "lateToleranceMs">;
const s3ReconciliationLateTolerance = {
  lateToleranceMs: () => 500,
} satisfies Pick<ReconcileStoredS3CoordinatorUploadsOptions, "lateToleranceMs">;
const s3PublisherLateTolerance = {
  lateToleranceMs: 500,
} satisfies Pick<RunPlannedStoredS3PublisherUploadStepOptions, "lateToleranceMs">;

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
    contentTypeBound: true,
    exactKey: true,
    methodBound: true,
    objectSizeCanBeObserved: true,
    presignedPut: true,
    requiredHeadersCanBeSigned: true,
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
const s3CompletionHint = {
  etag: '"abc"',
  objectKey: slot.objectKey,
  size: 98_304,
} satisfies S3RuntimeCompletionHintPayload;
const s3RuntimeCommitPayload = {
  commitId: "commit_3810",
  committedAt: "2026-01-01T00:00:02.000Z",
  objectKey: slot.objectKey,
  slotId: slot.slotId,
} satisfies S3RuntimeCommitPayload;
const s3RuntimeGrantOptions = {
  baseUrl: "https://edge.example.com",
  payload: {
    contentType: slot.contentType,
    deliveryUrl: slot.deliveryUrl,
    duration: slot.duration,
    expiresAt: slot.expiresAt,
    kind: slot.kind,
    maxBytes: slot.maxBytes,
    mediaSequenceNumber: slot.mediaSequenceNumber,
    objectKey: slot.objectKey,
    publicationMode: slot.publicationMode,
    publisherInstanceId: slot.publisherInstanceId,
    renditionId: slot.renditionId,
    slotId: slot.slotId,
  },
  sessionId: slot.sessionId,
} satisfies S3RuntimeIssueUploadGrantOptions;
const s3RuntimeCompletionOptions = {
  baseUrl: "https://edge.example.com",
  payload: s3CompletionHint,
  sessionId: slot.sessionId,
  slotId: slot.slotId,
} satisfies S3RuntimeCompleteUploadOptions;
const s3RuntimeCommitOptions = {
  baseUrl: "https://edge.example.com",
  payload: s3RuntimeCommitPayload,
  sessionId: slot.sessionId,
} satisfies S3RuntimeCommitUploadOptions;
const s3RuntimeReconciliationPlanPayload = {
  slotIds: [slot.slotId],
} satisfies S3RuntimeReconciliationPlanPayload;
const s3RuntimeReconciliationPayload = {
  committedAt: "2026-01-01T00:00:02.000Z",
  slotIds: [slot.slotId],
} satisfies S3RuntimeReconciliationPayload;
const s3RuntimeReconciliationPlanOptions = {
  baseUrl: "https://edge.example.com",
  payload: s3RuntimeReconciliationPlanPayload,
  sessionId: slot.sessionId,
} satisfies S3RuntimePlanReconciliationOptions;
const s3RuntimeReconciliationOptions = {
  baseUrl: "https://edge.example.com",
  payload: s3RuntimeReconciliationPayload,
  sessionId: slot.sessionId,
} satisfies S3RuntimeReconcileUploadsOptions;
const s3RuntimeRetentionPayload = {
  now: "2026-01-01T00:00:06.000Z",
} satisfies S3RuntimeRetentionPayload;
const s3RuntimeRetentionOptions = {
  baseUrl: "https://edge.example.com",
  payload: s3RuntimeRetentionPayload,
  sessionId: slot.sessionId,
} satisfies S3RuntimeApplyRetentionOptions;

const s3SlotGrantResponse: StoredS3CoordinatorSlotGrantResponse = {
  grant,
  slot,
};
const s3CommitResponse: StoredS3CoordinatorCommitResponse = {
  commit: {
    commitId: "commit_3810",
    committedAt: "2026-01-01T00:00:02.000Z",
    deliveryUrl: slot.deliveryUrl,
    duration: slot.duration,
    epoch: slot.epoch,
    mediaSequenceNumber: slot.mediaSequenceNumber,
    objectKey: slot.objectKey,
    providerId: "s3_primary",
    publicationMode: slot.publicationMode,
    renditionId: slot.renditionId,
    sessionId: slot.sessionId,
    size: 98_304,
    slotId: slot.slotId,
  },
};
const s3EventResponse: StoredS3CoordinatorEventRouteResponse = {
  results: [{ commit: s3CommitResponse.commit, status: "committed" }],
};
const s3ReconciliationResponse: StoredS3CoordinatorReconciliationResponse = {
  results: [
    {
      commit: s3CommitResponse.commit,
      slotId: slot.slotId,
      status: "committed",
    },
  ],
  summary: {
    committed: 1,
    failed: 0,
    failedErrorCodes: [],
    failedSlotIds: [],
    idempotent: 0,
    ok: true,
    planned: 1,
    slotIds: [slot.slotId],
    status: "reconciled",
  },
};
const s3RetentionResponse: StoredS3CoordinatorRetentionResponse = {
  plan: {
    expiredSlots: [],
    retiredObjects: [],
  },
  result: {
    deletedObjects: [],
    failedObjects: [],
  },
  summary: {
    deleted: 0,
    failed: 0,
    failedObjectKeys: [],
    failedSlotIds: [],
    ok: true,
    planned: 0,
  },
};
const s3PublisherSummary: StoredS3PublisherUploadStepSummary = {
  heartbeatStatus: "refreshed",
  ok: true,
  status: "committed",
};

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
serializedStore satisfies typeof createSerializedCoordinatorStore;
memorySerializedBackend satisfies typeof createMemorySerializedCoordinatorStoreBackend;
sqliteSerializedBackend satisfies typeof createSqliteSerializedCoordinatorStoreBackend;
sqliteSerializedSchema satisfies typeof createSqliteSerializedCoordinatorStoreSchema;
serializedBackendConformance satisfies typeof assertSerializedCoordinatorStoreBackendConformance;
nextEtag satisfies typeof createNextCoordinatorPipelineEtag;
parseSnapshot satisfies typeof parseCoordinatorPipelineSnapshot;
serializeSnapshot satisfies typeof serializeCoordinatorPipelineSnapshot;
retentionPlan satisfies typeof planCoordinatorRetention;
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
deletionSummary satisfies typeof summarizeRetiredCoordinatorObjectDeletions;
directPublicPolicyFactory satisfies typeof createDirectPublicSecurityPolicy;
directPublicMediaHeaders satisfies typeof createDirectPublicMediaResponseHeaders;
directPublicNegativeHeaders satisfies typeof createDirectPublicNegativeObjectResponseHeaders;
directPublicRequestPolicy satisfies typeof resolveDirectPublicMediaRequestPolicy;
s3RuntimeHandler satisfies typeof createStoredS3CoordinatorRuntimeHandler;
s3RuntimeGrantClient satisfies typeof issueS3RuntimeUploadGrant;
s3RuntimeCompletionClient satisfies typeof completeS3RuntimeUpload;
s3RuntimeCommitClient satisfies typeof commitS3RuntimeUpload;
s3RuntimeRetentionClient satisfies typeof applyS3RuntimeRetention;
presignedS3Grant satisfies typeof createPresignedS3UploadGrant;
observedS3HeadObject satisfies typeof createObservedUploadFromS3HeadObject;
observeS3 satisfies typeof observeS3Object;
issueS3Grant satisfies typeof issueStoredS3CoordinatorUploadGrant;
normalizeS3Events satisfies typeof normalizeS3ObjectCreatedEvents;
routeS3Event satisfies typeof routeStoredS3CoordinatorUploadEvent;
planS3RuntimeRecovery satisfies typeof planS3RuntimeReconciliation;
planS3Reconciliation satisfies typeof planStoredS3CoordinatorReconciliation;
reconcileS3RuntimeRecovery satisfies typeof reconcileS3RuntimeUploads;
reconcileS3Uploads satisfies typeof reconcileStoredS3CoordinatorUploads;
deleteS3Objects satisfies typeof deleteRetiredS3CoordinatorObjects;
plannedS3PublisherStep satisfies typeof runPlannedStoredS3PublisherUploadStep;
rawS3PublisherStep satisfies typeof runStoredS3PublisherUploadStep;
s3ReconciliationSummary satisfies typeof summarizeStoredS3CoordinatorUploadReconciliation;
s3PublisherStepSummary satisfies typeof summarizeStoredS3PublisherUploadStep;
s3SlotGrantResponse satisfies StoredS3CoordinatorSlotGrantResponse;
s3CommitResponse satisfies StoredS3CoordinatorCommitResponse;
s3EventResponse satisfies StoredS3CoordinatorEventRouteResponse;
s3ReconciliationResponse satisfies StoredS3CoordinatorReconciliationResponse;
s3RetentionResponse satisfies StoredS3CoordinatorRetentionResponse;
s3PublisherSummary satisfies StoredS3PublisherUploadStepSummary;
expiredSlots satisfies typeof selectExpiredUploadSlots;
retiredObjects satisfies typeof selectRetiredCommittedObjects;
runtimeCommitLateTolerance satisfies Pick<
  CommitCoordinatorUploadFromRequestOptions,
  "lateToleranceMs"
>;
runtimePublisherLateTolerance satisfies Pick<
  RunRuntimePublisherUploadStepOptions,
  "lateToleranceMs"
>;
s3RuntimeLateTolerance satisfies Pick<
  CreateStoredS3CoordinatorRuntimeHandlerOptions,
  "lateToleranceMs"
>;
s3ReconciliationLateTolerance satisfies Pick<
  ReconcileStoredS3CoordinatorUploadsOptions,
  "lateToleranceMs"
>;
s3PublisherLateTolerance satisfies Pick<
  RunPlannedStoredS3PublisherUploadStepOptions,
  "lateToleranceMs"
>;
s3CompletionHint satisfies S3RuntimeCompletionHintPayload;
s3RuntimeCommitPayload satisfies S3RuntimeCommitPayload;
s3RuntimeGrantOptions satisfies S3RuntimeIssueUploadGrantOptions;
s3RuntimeCompletionOptions satisfies S3RuntimeCompleteUploadOptions;
s3RuntimeCommitOptions satisfies S3RuntimeCommitUploadOptions;
s3RuntimeReconciliationPlanPayload satisfies S3RuntimeReconciliationPlanPayload;
s3RuntimeReconciliationPayload satisfies S3RuntimeReconciliationPayload;
s3RuntimeReconciliationPlanOptions satisfies S3RuntimePlanReconciliationOptions;
s3RuntimeReconciliationOptions satisfies S3RuntimeReconcileUploadsOptions;
s3RuntimeRetentionPayload satisfies S3RuntimeRetentionPayload;
s3RuntimeRetentionOptions satisfies S3RuntimeApplyRetentionOptions;
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
