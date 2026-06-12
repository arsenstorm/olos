import type { OlosId } from "../types/ids";
import {
  type CoordinatorPipelineState,
  type CoordinatorPipelineStore,
  cloneCoordinatorPipelineState,
  createNextCoordinatorPipelineEtag,
  parseCoordinatorPipelineSnapshot,
  serializeCoordinatorPipelineSnapshot,
} from "./coordinator";

export interface SerializedCoordinatorStoreRecord {
  etag: string;
  snapshot: string;
}

export interface SerializedCoordinatorStoreBackend {
  load(
    sessionId: OlosId
  ): Promise<SerializedCoordinatorStoreRecord | undefined>;
  save(
    options: SaveSerializedCoordinatorStoreOptions
  ): Promise<SerializedCoordinatorStoreSave>;
}

export interface SaveSerializedCoordinatorStoreOptions {
  expectedEtag?: string;
  record: SerializedCoordinatorStoreRecord;
  sessionId: OlosId;
}

export type SerializedCoordinatorStoreSave =
  | { status: "saved" }
  | {
      current?: SerializedCoordinatorStoreRecord;
      status: "conflict";
    };

export interface AssertSerializedCoordinatorStoreBackendConformanceOptions {
  createBackend():
    | SerializedCoordinatorStoreBackend
    | Promise<SerializedCoordinatorStoreBackend>;
}

export function createSerializedCoordinatorStore(
  backend: SerializedCoordinatorStoreBackend
): CoordinatorPipelineStore {
  return {
    async load(sessionId) {
      const record = await backend.load(sessionId);

      return record === undefined ? undefined : parseRecord(record);
    },
    async save(options) {
      const current = await backend.load(options.sessionId);
      const etag = createNextCoordinatorPipelineEtag(current?.etag);
      const record = createRecord(etag, options.state);
      const saved = await backend.save({
        expectedEtag: options.expectedEtag,
        record,
        sessionId: options.sessionId,
      });

      if (saved.status === "conflict") {
        return {
          current:
            saved.current === undefined
              ? undefined
              : parseRecord(saved.current),
          status: "conflict",
        };
      }

      return {
        etag,
        state: cloneCoordinatorPipelineState(options.state),
        status: "saved",
      };
    },
  };
}

export async function assertSerializedCoordinatorStoreBackendConformance(
  options: AssertSerializedCoordinatorStoreBackendConformanceOptions
): Promise<void> {
  const backend = await options.createBackend();
  const sessionId = "serialized_store_conformance";
  const first = record("1");
  const second = record("2");

  expectSerializedBackendValue(
    await backend.load(sessionId),
    undefined,
    "new serialized backend must not load missing sessions"
  );

  assertSerializedBackendSaved(
    await backend.save({ record: first, sessionId }),
    "insert without expected etag must save"
  );

  const duplicateInsert = await backend.save({ record: first, sessionId });
  assertSerializedBackendStatus(
    duplicateInsert.status,
    "conflict",
    "duplicate insert must conflict"
  );

  if (duplicateInsert.status === "conflict") {
    expectSerializedBackendValue(
      duplicateInsert.current?.etag,
      first.etag,
      "duplicate insert conflict should expose current etag when available"
    );
  }

  const staleUpdate = await backend.save({
    expectedEtag: "stale",
    record: second,
    sessionId,
  });
  assertSerializedBackendStatus(
    staleUpdate.status,
    "conflict",
    "stale update must conflict"
  );

  assertSerializedBackendSaved(
    await backend.save({
      expectedEtag: first.etag,
      record: second,
      sessionId,
    }),
    "matching expected etag update must save"
  );

  expectSerializedBackendValue(
    (await backend.load(sessionId))?.etag,
    second.etag,
    "matching expected etag update must publish the new record"
  );

  const missingUpdate = await backend.save({
    expectedEtag: "1",
    record: first,
    sessionId: "missing_serialized_store_conformance",
  });
  assertSerializedBackendStatus(
    missingUpdate.status,
    "conflict",
    "missing update must conflict"
  );
}

function createRecord(
  etag: string,
  state: CoordinatorPipelineState
): SerializedCoordinatorStoreRecord {
  return {
    etag,
    snapshot: serializeCoordinatorPipelineSnapshot({ etag, state }),
  };
}

function parseRecord(record: SerializedCoordinatorStoreRecord) {
  const snapshot = parseCoordinatorPipelineSnapshot(record.snapshot);

  if (snapshot.etag !== record.etag) {
    throw new Error("serialized coordinator record etag must match snapshot");
  }

  return snapshot;
}

function record(etag: string): SerializedCoordinatorStoreRecord {
  return {
    etag,
    snapshot: `{"etag":"${etag}"}`,
  };
}

function assertSerializedBackendSaved(
  result: SerializedCoordinatorStoreSave,
  message: string
): asserts result is Extract<
  SerializedCoordinatorStoreSave,
  { status: "saved" }
> {
  assertSerializedBackendStatus(result.status, "saved", message);
}

function assertSerializedBackendStatus(
  actual: string,
  expected: string,
  message: string
): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

function expectSerializedBackendValue<T>(
  actual: T,
  expected: T,
  message: string
): void {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}
