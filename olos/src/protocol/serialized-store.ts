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
