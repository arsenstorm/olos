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
    "renderMediaPlaylist",
    "resolveBlockingHlsManifestArtifactResponse",
    "resolveHlsManifestArtifactResponse",
  ],
  "olos/protocol": [
    "assertSerializedCoordinatorStoreBackendConformance",
    "createCoordinatorPipeline",
    "createMemoryCoordinatorStore",
    "createSerializedCoordinatorStore",
  ],
  "olos/runtime": [
    "createRuntimeObjectLowLatencyProfile",
    "createRuntimePublisherObjectKeyNonce",
    "createStoredCoordinatorSession",
    "createStoredCoordinatorRuntimeHandler",
    "getRuntimeMasterPlaylist",
    "getRuntimeMediaPlaylist",
    "getRuntimeSessionHealth",
    "getRuntimeSessionRetentionPlan",
    "planStoredCoordinatorRetention",
    "resolveRuntimeLiveHealth",
    "runRuntimePublisherUploadStep",
    "sendRuntimePublisherHeartbeat",
  ],
  "olos/s3": [
    "createPresignedS3UploadGrant",
    "createS3UploadGrant",
    "createObservedUploadFromS3HeadObject",
    "createStoredS3CoordinatorRuntimeHandler",
    "deleteRetiredS3CoordinatorObjects",
    "issueStoredS3CoordinatorUploadGrant",
    "observeS3Object",
    "planStoredS3CoordinatorReconciliation",
    "reconcileStoredS3CoordinatorUploads",
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
import { createRuntimeObjectLowLatencyProfile } from "olos/runtime";
import { createS3UploadGrant } from "olos/s3";
import type { Session, UploadGrant, UploadSlot } from "olos/types";
import { assertSession } from "olos/validation";

const profile = createRuntimeObjectLowLatencyProfile();

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
