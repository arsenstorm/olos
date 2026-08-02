import { describe, expect, test } from "bun:test";

import { commitCoordinatorUpload } from "../protocol/coordinator-commit";
import { createMemoryCoordinatorStore } from "../protocol/coordinator-memory-store";
import { issueCoordinatorSlot } from "../protocol/coordinator-slot";
import {
  createEmptyCoordinatorState,
  testCoordinatorSession as session,
} from "../protocol/coordinator-state.test-helper";
import type {
  CoordinatorPipelineState,
  CoordinatorPipelineStore,
} from "../protocol/coordinator-types";
import { savedStoreResult } from "../protocol/test-store.test-helper";
import { createObservedUpload } from "../state/observed-upload";
import {
  applyStoredCoordinatorRetention,
  deleteRetiredCoordinatorObjects,
  planStoredCoordinatorRetention,
  type RetiredCoordinatorObjectDeletion,
  summarizeRetiredCoordinatorObjectDeletions,
} from "./retention";

const RETIRED_OBJECT: RetiredCoordinatorObjectDeletion = {
  commitId: "commit_3810",
  objectKey: "media/v1080/s3810.m4s",
  slotId: "slot_3810",
};

const FAILED_RETIRED_OBJECT: RetiredCoordinatorObjectDeletion = {
  commitId: "commit_fail",
  objectKey: "media/fail.m4s",
  slotId: "slot_fail",
};

const SECOND_FAILED_RETIRED_OBJECT: RetiredCoordinatorObjectDeletion = {
  commitId: "commit_second_fail",
  objectKey: "media/second-fail.m4s",
  slotId: "slot_second_fail",
};

const OK_RETIRED_OBJECT: RetiredCoordinatorObjectDeletion = {
  commitId: "commit_ok",
  objectKey: "media/ok.m4s",
  slotId: "slot_ok",
};

const SECOND_OK_RETIRED_OBJECT: RetiredCoordinatorObjectDeletion = {
  commitId: "commit_second_ok",
  objectKey: "media/second-ok.m4s",
  slotId: "slot_second_ok",
};

describe("stored runtime retention", () => {
  test("plans app-owned retention work from stored coordinator state", async () => {
    const store = createMemoryCoordinatorStore();
    const saved = await store.save({
      sessionId: session.sessionId,
      state: retentionState(),
    });

    savedStoreResult(saved, "expected stored coordinator state");

    const result = await planStoredCoordinatorRetention({
      now: "2026-01-01T00:00:06.000Z",
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("planned");

    if (result.status !== "planned") {
      throw new Error("expected retention plan");
    }

    expect(result.response.status).toBe(200);
    expect(result.plan.expiredSlots.map((slot) => slot.slotId)).toEqual([
      "slot_3813",
    ]);
    // commit-time pruning already returned commit_3810 via the commit response;
    // planCoordinatorRetention only surfaces commits still resident in state.
    expect(result.plan.retiredObjects).toEqual([]);
    expect(await result.response.json()).toEqual({ plan: result.plan });
  });

  test("keeps tolerated slots out of stored retention plans", async () => {
    const store = createMemoryCoordinatorStore();
    const saved = await store.save({
      sessionId: session.sessionId,
      state: retentionState(),
    });

    savedStoreResult(saved, "expected stored coordinator state");

    // slot_3813 expires at 00:00:05; a 5s tolerance keeps it plannable for
    // the same grace window the commit path's lateToleranceMs allows.
    const result = await planStoredCoordinatorRetention({
      lateToleranceMs: 5000,
      now: "2026-01-01T00:00:06.000Z",
      sessionId: session.sessionId,
      store,
    });

    if (result.status !== "planned") {
      throw new Error("expected retention plan");
    }

    expect(result.plan.expiredSlots).toEqual([]);
  });

  test("returns not found for missing stored retention state", async () => {
    const result = await planStoredCoordinatorRetention({
      now: "2026-01-01T00:00:06.000Z",
      sessionId: "missing",
      store: createMemoryCoordinatorStore(),
    });

    expect(result.status).toBe("not_found");
    expect(result.response.status).toBe(404);
    expect(await result.response.json()).toEqual({
      error: {
        code: "olos.invalid_session",
        message: "coordinator session was not found",
      },
    });
  });

  test("rejects invalid stored retention options before loading state", async () => {
    let loads = 0;
    const store: CoordinatorPipelineStore = {
      load: () => {
        loads += 1;
        return Promise.resolve(undefined);
      },
      save: () => {
        throw new Error("store save should not be called");
      },
    };

    await expect(
      planStoredCoordinatorRetention({
        now: "2026-01-01T00:00:06.000Z",
        sessionId: "../session",
        store,
      })
    ).rejects.toThrow("sessionId must be a non-empty URL-safe identifier");
    await expect(
      planStoredCoordinatorRetention({
        now: "soon",
        sessionId: session.sessionId,
        store,
      })
    ).rejects.toThrow("now must be a valid timestamp");
    expect(loads).toBe(0);
  });

  test("applies stored retention and persists the pruned coordinator state", async () => {
    const store = createMemoryCoordinatorStore();
    const saved = await store.save({
      sessionId: session.sessionId,
      state: retentionState(),
    });

    savedStoreResult(saved, "expected stored coordinator state");

    const result = await applyStoredCoordinatorRetention({
      now: "2026-01-01T00:00:06.000Z",
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("applied");

    if (result.status !== "applied") {
      throw new Error("expected applied retention");
    }

    expect(result.response.status).toBe(200);
    expect(result.plan.expiredSlots.map((slot) => slot.slotId)).toEqual([
      "slot_3813",
    ]);
    expect(result.plan.retiredObjects).toEqual([]);
    expect(result.state.slots.map((slot) => slot.slotId)).not.toContain(
      "slot_3813"
    );
    expect(await result.response.json()).toEqual({ plan: result.plan });

    const reloaded = await store.load(session.sessionId);

    expect(reloaded?.etag).toBe(result.etag);
    expect(reloaded?.state.slots.map((slot) => slot.slotId)).not.toContain(
      "slot_3813"
    );
  });

  test("skips saving stored retention when there is nothing to prune", async () => {
    const store = createMemoryCoordinatorStore();
    const saved = await store.save({
      sessionId: session.sessionId,
      state: retentionState(),
    });

    savedStoreResult(saved, "expected stored coordinator state");

    const first = await applyStoredCoordinatorRetention({
      now: "2026-01-01T00:00:06.000Z",
      sessionId: session.sessionId,
      store,
    });

    expect(first.status).toBe("applied");

    let saves = 0;
    const countingStore: CoordinatorPipelineStore = {
      load: (sessionId) => store.load(sessionId),
      save: (options) => {
        saves += 1;
        return store.save(options);
      },
    };
    const second = await applyStoredCoordinatorRetention({
      now: "2026-01-01T00:00:06.000Z",
      sessionId: session.sessionId,
      store: countingStore,
    });

    expect(second.status).toBe("unchanged");

    if (second.status !== "unchanged") {
      throw new Error("expected unchanged retention");
    }

    expect(saves).toBe(0);
    expect(second.response.status).toBe(200);
    expect(second.plan.expiredSlots).toEqual([]);
    expect(second.plan.retiredObjects).toEqual([]);
  });

  test("returns not found when applying retention for a missing session", async () => {
    const result = await applyStoredCoordinatorRetention({
      now: "2026-01-01T00:00:06.000Z",
      sessionId: "missing",
      store: createMemoryCoordinatorStore(),
    });

    expect(result.status).toBe("not_found");
    expect(result.response.status).toBe(404);
    expect(await result.response.json()).toEqual({
      error: {
        code: "olos.invalid_session",
        message: "coordinator session was not found",
      },
    });
  });

  test("reports a conflict when the stored retention save keeps losing", async () => {
    const store = createMemoryCoordinatorStore();
    const saved = await store.save({
      sessionId: session.sessionId,
      state: retentionState(),
    });

    savedStoreResult(saved, "expected stored coordinator state");

    const conflictingStore: CoordinatorPipelineStore = {
      load: (sessionId) => store.load(sessionId),
      save: async () => {
        const current = await store.load(session.sessionId);

        if (current === undefined) {
          throw new Error("expected stored coordinator state");
        }

        return { current, status: "conflict" as const };
      },
    };
    const result = await applyStoredCoordinatorRetention({
      now: "2026-01-01T00:00:06.000Z",
      sessionId: session.sessionId,
      store: conflictingStore,
    });

    expect(result.status).toBe("conflict");
    expect(result.response.status).toBe(409);
  });

  test("rejects invalid stored retention application options before loading state", async () => {
    let loads = 0;
    const store: CoordinatorPipelineStore = {
      load: () => {
        loads += 1;
        return Promise.resolve(undefined);
      },
      save: () => {
        throw new Error("store save should not be called");
      },
    };

    await expect(
      applyStoredCoordinatorRetention({
        now: "2026-01-01T00:00:06.000Z",
        sessionId: "../session",
        store,
      })
    ).rejects.toThrow("sessionId must be a non-empty URL-safe identifier");
    await expect(
      applyStoredCoordinatorRetention({
        maxAttempts: 0,
        now: "2026-01-01T00:00:06.000Z",
        sessionId: session.sessionId,
        store,
      })
    ).rejects.toThrow("maxAttempts must be a positive integer");
    expect(loads).toBe(0);
  });

  test("deletes retired coordinator objects through an app-owned callback", async () => {
    const deleted: string[] = [];
    const result = await deleteRetiredCoordinatorObjects({
      deleteObject: (object) => {
        deleted.push(object.objectKey);
      },
      objects: [RETIRED_OBJECT],
    });

    expect(deleted).toEqual(["media/v1080/s3810.m4s"]);
    expect(result).toEqual({
      deletedObjects: [RETIRED_OBJECT],
      failedObjects: [],
    });
    expect(summarizeRetiredCoordinatorObjectDeletions(result)).toEqual({
      deleted: 1,
      failed: 0,
      failedObjectKeys: [],
      failedSlotIds: [],
      ok: true,
      planned: 1,
    });
  });

  test("summarizes an empty retired object deletion plan", async () => {
    const result = await deleteRetiredCoordinatorObjects({
      deleteObject: () => {
        throw new Error("delete should not be called");
      },
      objects: [],
    });

    expect(result).toEqual({
      deletedObjects: [],
      failedObjects: [],
    });
    expect(summarizeRetiredCoordinatorObjectDeletions(result)).toEqual({
      deleted: 0,
      failed: 0,
      failedObjectKeys: [],
      failedSlotIds: [],
      ok: true,
      planned: 0,
    });
  });

  test("keeps deleting retired coordinator objects after a failure", async () => {
    const result = await deleteRetiredCoordinatorObjects({
      deleteObject: (object) => {
        if (object.objectKey === "media/fail.m4s") {
          throw new Error("delete failed");
        }
      },
      objects: [FAILED_RETIRED_OBJECT, OK_RETIRED_OBJECT],
    });

    expect(result.deletedObjects).toEqual([OK_RETIRED_OBJECT]);
    expect(result.failedObjects).toEqual([
      {
        error: "delete failed",
        object: FAILED_RETIRED_OBJECT,
      },
    ]);
    expect(summarizeRetiredCoordinatorObjectDeletions(result)).toEqual({
      deleted: 1,
      failed: 1,
      failedObjectKeys: ["media/fail.m4s"],
      failedSlotIds: ["slot_fail"],
      ok: false,
      planned: 2,
    });
  });

  test("keeps deleting retired coordinator objects after an async failure", async () => {
    const result = await deleteRetiredCoordinatorObjects({
      deleteObject: (object) => {
        if (object.objectKey === "media/fail.m4s") {
          return Promise.reject(new Error("async delete failed"));
        }

        return Promise.resolve();
      },
      objects: [FAILED_RETIRED_OBJECT, OK_RETIRED_OBJECT],
    });

    expect(result).toEqual({
      deletedObjects: [OK_RETIRED_OBJECT],
      failedObjects: [
        {
          error: "async delete failed",
          object: FAILED_RETIRED_OBJECT,
        },
      ],
    });
  });

  test("deletes retired coordinator objects concurrently while preserving order", async () => {
    const objects: RetiredCoordinatorObjectDeletion[] = [
      RETIRED_OBJECT,
      OK_RETIRED_OBJECT,
      SECOND_OK_RETIRED_OBJECT,
    ];
    const started: string[] = [];
    let releaseFirst: () => void = () => {
      throw new Error("first delete gate was not armed");
    };
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const result = await deleteRetiredCoordinatorObjects({
      concurrency: 2,
      deleteObject: (object) => {
        started.push(object.objectKey);

        if (object.objectKey === RETIRED_OBJECT.objectKey) {
          // Only resolves once the last object starts, which requires a
          // second worker to keep draining the queue while this delete is
          // still in flight.
          return firstGate;
        }

        if (object.objectKey === SECOND_OK_RETIRED_OBJECT.objectKey) {
          releaseFirst();
        }

        return Promise.resolve();
      },
      objects,
    });

    expect(started).toEqual([
      RETIRED_OBJECT.objectKey,
      OK_RETIRED_OBJECT.objectKey,
      SECOND_OK_RETIRED_OBJECT.objectKey,
    ]);
    expect(result).toEqual({
      deletedObjects: objects,
      failedObjects: [],
    });
  });

  test("isolates per-object failures across concurrent deletes", async () => {
    const result = await deleteRetiredCoordinatorObjects({
      concurrency: 3,
      deleteObject: (object) => {
        if (object.objectKey === "media/fail.m4s") {
          return Promise.reject(new Error("delete failed"));
        }

        return Promise.resolve();
      },
      objects: [OK_RETIRED_OBJECT, FAILED_RETIRED_OBJECT, RETIRED_OBJECT],
    });

    expect(result).toEqual({
      deletedObjects: [OK_RETIRED_OBJECT, RETIRED_OBJECT],
      failedObjects: [
        {
          error: "delete failed",
          object: FAILED_RETIRED_OBJECT,
        },
      ],
    });
  });

  test("rejects invalid delete concurrency before deleting objects", async () => {
    const deleted: string[] = [];
    const deleteObject = (object: RetiredCoordinatorObjectDeletion) => {
      deleted.push(object.objectKey);
    };

    await expect(
      deleteRetiredCoordinatorObjects({
        concurrency: 0,
        deleteObject,
        objects: [RETIRED_OBJECT],
      })
    ).rejects.toThrow("concurrency must be a positive integer");
    await expect(
      deleteRetiredCoordinatorObjects({
        concurrency: 1.5,
        deleteObject,
        objects: [RETIRED_OBJECT],
      })
    ).rejects.toThrow("concurrency must be a positive integer");
    expect(deleted).toEqual([]);
  });

  test("summarizes failed retired objects by object key and slot id", () => {
    expect(
      summarizeRetiredCoordinatorObjectDeletions({
        deletedObjects: [OK_RETIRED_OBJECT],
        failedObjects: [
          {
            error: "delete failed",
            object: FAILED_RETIRED_OBJECT,
          },
          {
            error: "second delete failed",
            object: SECOND_FAILED_RETIRED_OBJECT,
          },
        ],
      })
    ).toEqual({
      deleted: 1,
      failed: 2,
      failedObjectKeys: ["media/fail.m4s", "media/second-fail.m4s"],
      failedSlotIds: ["slot_fail", "slot_second_fail"],
      ok: false,
      planned: 3,
    });
  });
});

function retentionState(): CoordinatorPipelineState {
  let state = createEmptyCoordinatorState();

  state = commitSlot(state, {
    commitId: "commit_init",
    deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
    duration: 1,
    maxBytes: 2048,
    mediaSequenceNumber: 0,
    objectKey: "media/v1080/init.mp4",
    slotId: "slot_init",
    size: 1024,
  });
  state = commitSlot(state, {
    commitId: "commit_3810",
    deliveryUrl: "https://media.example.com/media/v1080/s3810.m4s",
    duration: 2,
    independent: true,
    maxBytes: 100_000,
    mediaSequenceNumber: 3810,
    objectKey: "media/v1080/s3810.m4s",
    slotId: "slot_3810",
    size: 98_304,
  });
  state = commitSlot(state, {
    commitId: "commit_3811",
    deliveryUrl: "https://media.example.com/s3811.m4s",
    duration: 2,
    independent: true,
    maxBytes: 100_000,
    mediaSequenceNumber: 3811,
    objectKey: "media/s3811.m4s",
    slotId: "slot_3811",
    size: 98_304,
  });
  state = commitSlot(state, {
    commitId: "commit_3812",
    deliveryUrl: "https://media.example.com/s3812.m4s",
    duration: 2,
    independent: true,
    maxBytes: 100_000,
    maxSegments: 2,
    mediaSequenceNumber: 3812,
    objectKey: "media/s3812.m4s",
    slotId: "slot_3812",
    size: 98_304,
  });

  return issueCoordinatorSlot({
    contentType: "video/mp4",
    duration: 2,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: "segment",
    maxBytes: 100_000,
    mediaSequenceNumber: 3813,
    renditionId: "v1080",
    slotId: "slot_3813",
    state,
  }).state;
}

interface CommitSlotOptions {
  commitId: string;
  deliveryUrl: string;
  duration: number;
  independent?: boolean;
  maxBytes: number;
  maxSegments?: number;
  mediaSequenceNumber: number;
  objectKey: string;
  size: number;
  slotId: string;
}

function commitSlot(
  state: CoordinatorPipelineState,
  options: CommitSlotOptions
): CoordinatorPipelineState {
  const issued = issueCoordinatorSlot({
    contentType: "video/mp4",
    duration: options.duration,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: options.slotId === "slot_init" ? "init" : "segment",
    maxBytes: options.maxBytes,
    mediaSequenceNumber: options.mediaSequenceNumber,
    renditionId: "v1080",
    slotId: options.slotId,
    state,
  });
  const committed = commitCoordinatorUpload({
    commitId: options.commitId,
    committedAt: "2026-01-01T00:00:02.000Z",
    independent: options.independent,
    maxSegments: options.maxSegments,
    object: createObservedUpload({
      contentType: "video/mp4",
      objectKey: issued.slot.objectKey,
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: options.size,
    }),
    slotId: options.slotId,
    state: issued.state,
  });

  if (committed.status !== "committed") {
    throw new Error("expected committed upload");
  }

  return committed.state;
}
