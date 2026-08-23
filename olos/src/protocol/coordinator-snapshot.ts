import type { Commit } from "../types/commit";
import type { UploadSlot } from "../types/upload-slot";
import { assertCommit } from "../validation/commit";
import { assertCursor } from "../validation/cursor";
import { assertSafeDeliveryUrl } from "../validation/delivery-url";
import {
  assertIsoDateField,
  assertUrlSafeField,
  errorMessage,
  isRecord,
} from "../validation/fields";
import { assertNonNegativeInteger } from "../validation/ids";
import { assertSession } from "../validation/session";
import { assertUploadSlot } from "../validation/upload-slot";
import type {
  CoordinatorCursorView,
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineState,
  CoordinatorPublisherLease,
} from "./coordinator-types";

/**
 * Deep-clone a snapshot (etag plus state) so the copy shares no mutable
 * objects with the original. Store implementations use this to keep cached
 * snapshots isolated from caller mutations.
 */
export function cloneCoordinatorPipelineSnapshot(
  snapshot: CoordinatorPipelineSnapshot
): CoordinatorPipelineSnapshot {
  return {
    etag: snapshot.etag,
    state: cloneCoordinatorPipelineState(snapshot.state),
  };
}

/**
 * Deep-clone a pipeline state: commits, slots, leases, cursor, and session
 * tracks are all copied, so the clone shares no mutable objects (including
 * nested ones such as a slot's `byterange`/`profile` or the cursor's
 * `committedWindow`) with the original. A missing `publisherLeases` array is
 * normalized to an empty one, so clones of pre-lease snapshots are always
 * well formed.
 */
export function cloneCoordinatorPipelineState(
  state: CoordinatorPipelineState
): CoordinatorPipelineState {
  return {
    ...structuredClone(state),
    publisherLeases: structuredClone(state.publisherLeases ?? []),
  };
}

/**
 * Serialize a snapshot to the JSON wire form that
 * `parseCoordinatorPipelineSnapshot` accepts. The snapshot is cloned first,
 * so serialization never observes concurrent caller mutations.
 */
export function serializeCoordinatorPipelineSnapshot(
  snapshot: CoordinatorPipelineSnapshot
): string {
  return JSON.stringify(cloneCoordinatorPipelineSnapshot(snapshot));
}

/**
 * Parse and validate a snapshot from untrusted input — a JSON string (as
 * produced by `serializeCoordinatorPipelineSnapshot`) or an already-parsed
 * value. Every field is validated (session, slots, commits, leases, cursor,
 * etag); invalid input throws with a message naming the offending field.
 * Returns a defensive deep clone, never the input value itself.
 */
export function parseCoordinatorPipelineSnapshot(
  value: unknown
): CoordinatorPipelineSnapshot {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;

  assertCoordinatorPipelineSnapshot(parsed);

  return cloneCoordinatorPipelineSnapshot(parsed);
}

/**
 * Compute the etag for the next saved snapshot version: `"1"` for a fresh
 * session, otherwise the current numeric etag incremented by one. Throws
 * when `current` is not a non-negative safe integer string. Store
 * implementations use this to keep etags monotonically increasing.
 */
export function createNextCoordinatorPipelineEtag(current?: string): string {
  if (current === undefined) {
    return "1";
  }

  const value = Number(current);

  assertNonNegativeInteger(value, "coordinator pipeline etag");

  return String(value + 1);
}

export function cursorViewFromSnapshot(
  snapshot: CoordinatorPipelineSnapshot
): CoordinatorCursorView {
  return {
    ...(snapshot.state.cursor === undefined
      ? {}
      : { cursor: snapshot.state.cursor }),
    etag: snapshot.etag,
    session: snapshot.state.session,
  };
}

function assertCoordinatorPipelineSnapshot(
  value: unknown
): asserts value is CoordinatorPipelineSnapshot {
  if (!isRecord(value)) {
    throw new Error("coordinator pipeline snapshot must be an object");
  }

  if (typeof value.etag !== "string" || value.etag.length === 0) {
    throw new Error(
      "coordinator pipeline snapshot etag must be a non-empty string"
    );
  }

  assertCoordinatorPipelineState(value.state);
}

function assertCoordinatorPipelineState(
  value: unknown
): asserts value is CoordinatorPipelineState {
  if (!isRecord(value)) {
    throw new Error("coordinator pipeline state must be an object");
  }

  assertSession(value.session);
  assertSafeDeliveryUrl(
    value.deliveryBaseUrl,
    "coordinator pipeline state deliveryBaseUrl"
  );
  assertEach<UploadSlot>(
    value.slots,
    "coordinator pipeline state slots",
    "uploadSlot",
    assertUploadSlot
  );
  assertEach<Commit>(
    value.initCommits,
    "coordinator pipeline state initCommits",
    "commit",
    assertCommit
  );
  assertEach<Commit>(
    value.commits,
    "coordinator pipeline state commits",
    "commit",
    assertCommit
  );
  if (value.publisherLeases !== undefined) {
    assertPublisherLeases(value.publisherLeases);
  }

  if (value.cursor !== undefined && !isRecord(value.cursor)) {
    throw new Error("coordinator pipeline state cursor must be an object");
  }

  if (value.cursor !== undefined) {
    assertCursor(value.cursor);
  }
}

function assertEach<T>(
  value: unknown,
  name: string,
  itemLabel: string,
  assertItem: (item: unknown) => asserts item is T
): asserts value is T[] {
  assertArray(value, name);
  value.forEach((entry, index) => {
    try {
      assertItem(entry);
    } catch (error) {
      throw new Error(
        `${name} must contain valid ${itemLabel} at index ${index}: ${errorMessage(error, String(error))}`,
        { cause: error }
      );
    }
  });
}

function assertPublisherLeases(
  value: unknown
): asserts value is readonly CoordinatorPublisherLease[] {
  assertArray(value, "coordinator pipeline state publisherLeases");

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(
        `coordinator pipeline state publisherLeases must contain an object at index ${index}`
      );
    }

    assertIsoDateField(
      entry,
      "expiresAt",
      "coordinator pipeline publisher lease"
    );
    assertIsoDateField(
      entry,
      "issuedAt",
      "coordinator pipeline publisher lease"
    );
    assertIsoDateField(
      entry,
      "lastSeenAt",
      "coordinator pipeline publisher lease"
    );
    assertUrlSafeField(
      entry,
      "publisherInstanceId",
      "coordinator pipeline publisher lease"
    );
    assertUrlSafeField(
      entry,
      "sessionId",
      "coordinator pipeline publisher lease"
    );
  });
}

function assertArray(value: unknown, name: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
}
