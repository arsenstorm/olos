import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export const expectedRuntimeExports = {
  olos: ["OLOS_PROTOCOL_NAME"],
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
    "getRuntimeSessionHealth",
    "planStoredCoordinatorRetention",
    "resolveRuntimeLiveHealth",
    "runRuntimePublisherUploadStep",
    "sendRuntimePublisherHeartbeat",
  ],
  "olos/s3": [
    "createS3UploadGrant",
    "createStoredS3CoordinatorRuntimeHandler",
    "deleteRetiredS3CoordinatorObjects",
    "issueStoredS3CoordinatorUploadGrant",
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

export async function writePackageSmokeFile(root: string): Promise<void> {
  await writeFile(join(root, "smoke.mjs"), packageSmokeSource());
}

function packageSmokeSource(): string {
  return `
import { readFile } from "node:fs/promises";

const expectedRuntimeExports = ${JSON.stringify(expectedRuntimeExports)};
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
