import type { Commit } from "../types/commit";
import { assertCommit } from "../validation/commit";
import { assertCursor } from "../validation/cursor";
import { assertSafeDeliveryUrl } from "../validation/delivery-url";
import {
  assertIsoDateField,
  assertUrlSafeField,
  isRecord,
} from "../validation/fields";
import { assertSession } from "../validation/session";
import { assertUploadSlot } from "../validation/upload-slot";
import type {
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineState,
  CoordinatorPublisherLease,
} from "./coordinator";

export function cloneCoordinatorPipelineSnapshot(
  snapshot: CoordinatorPipelineSnapshot
): CoordinatorPipelineSnapshot {
  return {
    etag: snapshot.etag,
    state: cloneCoordinatorPipelineState(snapshot.state),
  };
}

export function cloneCoordinatorPipelineState(
  state: CoordinatorPipelineState
): CoordinatorPipelineState {
  return {
    ...state,
    commits: state.commits.map((commit) => ({ ...commit })),
    initCommits: state.initCommits.map((commit) => ({ ...commit })),
    publisherLeases: (state.publisherLeases ?? []).map((lease) => ({
      ...lease,
    })),
    slots: state.slots.map((slot) => ({ ...slot })),
    ...(state.cursor === undefined ? {} : { cursor: { ...state.cursor } }),
    session: {
      ...state.session,
      renditions: state.session.renditions.map((rendition) => ({
        ...rendition,
      })),
    },
  };
}

export function serializeCoordinatorPipelineSnapshot(
  snapshot: CoordinatorPipelineSnapshot
): string {
  return JSON.stringify(cloneCoordinatorPipelineSnapshot(snapshot));
}

export function parseCoordinatorPipelineSnapshot(
  value: unknown
): CoordinatorPipelineSnapshot {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;

  assertCoordinatorPipelineSnapshot(parsed);

  return cloneCoordinatorPipelineSnapshot(parsed);
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
    value.mediaBaseUrl,
    "coordinator pipeline state mediaBaseUrl"
  );
  assertUploadSlots(value.slots);
  assertCommits(value.initCommits, "coordinator pipeline state initCommits");
  assertCommits(value.commits, "coordinator pipeline state commits");
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

function assertCommits(
  value: unknown,
  name: string
): asserts value is readonly Commit[] {
  assertArray(value, name);
  value.forEach((entry, index) => {
    try {
      assertCommit(entry);
    } catch (error) {
      throw new Error(
        `${name} must contain valid commit at index ${index}: ${(error as Error).message}`
      );
    }
  });
}

function assertUploadSlots(value: unknown): void {
  assertArray(value, "coordinator pipeline state slots");
  value.forEach((slot, index) => {
    try {
      assertUploadSlot(slot);
    } catch (error) {
      throw new Error(
        `coordinator pipeline state slots must contain valid uploadSlot at index ${index}: ${
          (error as Error).message
        }`
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
    assertUrlSafeField(
      entry,
      "tenantId",
      "coordinator pipeline publisher lease"
    );
  });
}

function assertArray(value: unknown, name: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
}
