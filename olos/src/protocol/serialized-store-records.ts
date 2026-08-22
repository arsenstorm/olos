import type { Cursor } from "../types/cursor";
import type { Session } from "../types/session";
import { assertCursor } from "../validation/cursor";
import { isRecord } from "../validation/fields";
import { assertSession } from "../validation/session";
import {
  createNextCoordinatorPipelineEtag,
  cursorViewFromSnapshot,
  parseCoordinatorPipelineSnapshot,
  serializeCoordinatorPipelineSnapshot,
} from "./coordinator-snapshot";
import type {
  CoordinatorCursorView,
  CoordinatorPipelineState,
} from "./coordinator-types";
import type {
  CoordinatorStoreSaveConflict,
  SerializedCoordinatorStoreConflict,
  SerializedCoordinatorStoreRecord,
  SerializedCursorViewRecord,
} from "./serialized-store";

export function nextSerializedCoordinatorStoreEtag(
  expectedEtag?: string
): string {
  try {
    return createNextCoordinatorPipelineEtag(expectedEtag);
  } catch {
    // A malformed expectedEtag can never match a stored etag (this store
    // only ever writes numeric etags), so the backend save is guaranteed to
    // conflict and the placeholder is never persisted.
    return "0";
  }
}

export function createRecord(
  etag: string,
  state: CoordinatorPipelineState
): SerializedCoordinatorStoreRecord {
  return {
    etag,
    snapshot: serializeCoordinatorPipelineSnapshot({ etag, state }),
  };
}

export function cloneRecord(
  record: SerializedCoordinatorStoreRecord
): SerializedCoordinatorStoreRecord {
  return {
    etag: record.etag,
    snapshot: record.snapshot,
  };
}

export function serializedCoordinatorStoreConflict(
  current?: SerializedCoordinatorStoreRecord
): SerializedCoordinatorStoreConflict {
  return {
    ...(current === undefined ? {} : { current }),
    status: "conflict",
  };
}

export function coordinatorStoreConflictFromSerialized(
  conflict: SerializedCoordinatorStoreConflict
): CoordinatorStoreSaveConflict {
  return {
    current:
      conflict.current === undefined
        ? undefined
        : parseRecord(conflict.current),
    status: "conflict",
  };
}

export function parseRecord(record: SerializedCoordinatorStoreRecord) {
  const snapshot = parseCoordinatorPipelineSnapshot(record.snapshot);

  if (snapshot.etag !== record.etag) {
    throw new Error("serialized coordinator record etag must match snapshot");
  }

  return snapshot;
}

interface ParsedCursorView {
  cursor?: Cursor;
  /**
   * Etag duplicated inside the JSON body so a view row whose columns were
   * torn apart (e.g. a partial copy pairing one session's etag with
   * another's view) is detected on read, mirroring `parseRecord`'s
   * snapshot-etag cross-check.
   */
  etag: string;
  session: Session;
}

export function createCursorViewRecord(
  etag: string,
  state: CoordinatorPipelineState
): SerializedCursorViewRecord {
  return {
    etag,
    view: JSON.stringify(cursorViewFromSnapshot({ etag, state })),
  };
}

export function parseCursorViewRecord(
  record: SerializedCursorViewRecord & { view: string }
): CoordinatorCursorView {
  const parsed: unknown = JSON.parse(record.view);

  assertParsedCursorView(parsed);

  if (parsed.etag !== record.etag) {
    throw new Error("serialized cursor view etag must match record");
  }

  return {
    ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
    etag: record.etag,
    session: parsed.session,
  };
}

function assertParsedCursorView(
  value: unknown
): asserts value is ParsedCursorView {
  if (!isRecord(value)) {
    throw new Error("serialized cursor view must be an object");
  }

  if (typeof value.etag !== "string" || value.etag.length === 0) {
    throw new Error("serialized cursor view must include an etag");
  }

  assertSession(value.session);

  if (value.cursor !== undefined) {
    assertCursor(value.cursor);
  }
}
