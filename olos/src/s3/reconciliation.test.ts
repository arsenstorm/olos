import { describe, expect, test } from "bun:test";
import {
  createMemoryCoordinatorStore,
  issueCoordinatorSlot,
} from "../protocol";
import type { CoordinatorPipelineState } from "../protocol/coordinator";
import {
  createEmptyCoordinatorState,
  testCoordinatorSession as session,
} from "../protocol/coordinator-state.test-helper";
import { savedStoreResult } from "../protocol/test-store.test-helper";
import type { S3HeadObjectClient } from "./object-observation";
import {
  planStoredS3CoordinatorReconciliation,
  reconcileStoredS3CoordinatorUploads,
  type StoredS3CoordinatorUploadReconciliationCommit,
  summarizeStoredS3CoordinatorUploadReconciliation,
} from "./reconciliation";
import { createTestHeadObjectClientFor } from "./test-client.test-helper";

describe("stored S3 upload reconciliation", () => {
  test("reports missing sessions consistently for plans and reconciliation", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();

    await expect(
      planStoredS3CoordinatorReconciliation({
        sessionId: session.sessionId,
        store,
      })
    ).resolves.toEqual({ status: "not_found" });
    await expect(
      reconcileStoredS3CoordinatorUploads({
        bucket: "media",
        client: clientFor(new Map(), headObjectInputs),
        committedAt: "2026-01-01T00:00:02.000Z",
        providerId: "s3_primary",
        sessionId: session.sessionId,
        store,
      })
    ).resolves.toEqual({ status: "not_found" });
    expect(headObjectInputs).toEqual([]);
  });

  test("plans in-flight S3 slots for app-owned recovery jobs", async () => {
    const store = createMemoryCoordinatorStore();

    await saveReconciliationState(store);

    const plan = await planStoredS3CoordinatorReconciliation({
      sessionId: session.sessionId,
      slotIds: ["slot_3810"],
      store,
    });

    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") {
      throw new Error("expected reconciliation plan");
    }

    expect(plan.slotIds).toEqual(["slot_3810"]);
    expect(plan.slots).toHaveLength(1);
    expect(plan.slots[0]?.objectKey).toBe("media/v1080/3810.m4s");
  });

  test("commits existing S3 objects for issued slots", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();

    await saveReconciliationState(store);

    const result = await reconcileStoredS3CoordinatorUploads({
      bucket: "media",
      client: clientFor(
        new Map([
          ["media/v1080/init.mp4", 1024],
          ["media/v1080/3810.m4s", 98_304],
        ]),
        headObjectInputs
      ),
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: (slot) => slot.kind === "segment",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
    });
    const snapshot = await store.load(session.sessionId);

    expect(result.status).toBe("reconciled");
    if (result.status !== "reconciled") {
      throw new Error("expected reconciliation result");
    }

    expect(result.results.map((entry) => entry.status)).toEqual([
      "committed",
      "committed",
    ]);
    expect(summarizeStoredS3CoordinatorUploadReconciliation(result)).toEqual({
      committed: 2,
      failed: 0,
      failedErrorCodes: [],
      failedSlotIds: [],
      idempotent: 0,
      ok: true,
      planned: 2,
      slotIds: ["slot_init", "slot_3810"],
      status: "reconciled",
    });
    expect(snapshot?.state.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/v1080/init.mp4",
      },
      {
        Bucket: "media",
        Key: "media/v1080/3810.m4s",
      },
    ]);
  });

  test("reconciles only requested S3 slot identifiers", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();

    await saveReconciliationState(store);

    const result = await reconcileStoredS3CoordinatorUploads({
      bucket: "media",
      client: clientFor(
        new Map([["media/v1080/3810.m4s", 98_304]]),
        headObjectInputs
      ),
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotIds: ["slot_3810"],
      store,
    });

    expect(result.status).toBe("reconciled");
    if (result.status !== "reconciled") {
      throw new Error("expected reconciliation result");
    }

    expect(result.results.map((entry) => entry.slot.slotId)).toEqual([
      "slot_3810",
    ]);
    expect(summarizeStoredS3CoordinatorUploadReconciliation(result)).toEqual({
      committed: 1,
      failed: 0,
      failedErrorCodes: [],
      failedSlotIds: [],
      idempotent: 0,
      ok: true,
      planned: 1,
      slotIds: ["slot_3810"],
      status: "reconciled",
    });
    expect(headObjectInputs).toEqual([
      {
        Bucket: "media",
        Key: "media/v1080/3810.m4s",
      },
    ]);
  });

  test("honors commit policy during recovery commits", async () => {
    const store = createMemoryCoordinatorStore();

    await saveReconciliationState(store);

    const result = await reconcileStoredS3CoordinatorUploads({
      bucket: "media",
      client: clientFor(
        new Map([
          ["media/v1080/init.mp4", 1024],
          ["media/v1080/3810.m4s", 98_304],
        ]),
        []
      ),
      commitPolicy: ({ slot }) =>
        slot.kind === "init"
          ? { status: "allowed" }
          : {
              error: {
                error: {
                  code: "olos.quota_exceeded",
                  message: "tenant quota exceeded",
                },
              },
              status: "rejected",
            },
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: (slot) => slot.kind === "segment",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
    });
    const snapshot = await store.load(session.sessionId);

    expect(result.status).toBe("reconciled");
    if (result.status !== "reconciled") {
      throw new Error("expected reconciliation result");
    }

    expect(result.results.map((entry) => entry.status)).toEqual([
      "committed",
      "failed",
    ]);
    expect(result.results[1]).toMatchObject({
      result: {
        error: {
          error: {
            code: "olos.quota_exceeded",
            message: "tenant quota exceeded",
          },
        },
        status: "rejected",
      },
      status: "failed",
    });
    expect(summarizeStoredS3CoordinatorUploadReconciliation(result)).toEqual({
      committed: 1,
      failed: 1,
      failedErrorCodes: ["olos.quota_exceeded"],
      failedSlotIds: ["slot_3810"],
      idempotent: 0,
      ok: false,
      planned: 2,
      slotIds: ["slot_init", "slot_3810"],
      status: "reconciled",
    });
    expect(snapshot?.state.commits).toHaveLength(0);
    expect(snapshot?.state.initCommits).toHaveLength(1);
    expect(snapshot?.state.cursor).toBeUndefined();
  });

  test("resolves slot-derived commit identifiers during recovery", async () => {
    const store = createMemoryCoordinatorStore();

    await saveReconciliationState(store);

    const result = await reconcileStoredS3CoordinatorUploads({
      bucket: "media",
      client: clientFor(new Map([["media/v1080/3810.m4s", 98_304]]), []),
      commitId: (slot) => `custom_${slot.slotId}`,
      committedAt: "2026-01-01T00:00:02.000Z",
      independent: true,
      providerId: "s3_primary",
      sessionId: session.sessionId,
      slotIds: ["slot_3810"],
      store,
    });

    expect(result.status).toBe("reconciled");
    if (result.status !== "reconciled") {
      throw new Error("expected reconciliation result");
    }

    expect(result.results[0]).toMatchObject({
      commit: {
        commit: {
          commitId: "custom_slot_3810",
        },
      },
      status: "committed",
    });
  });

  test("reports failed slots without stopping reconciliation", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();

    await saveReconciliationState(store);

    const result = await reconcileStoredS3CoordinatorUploads({
      bucket: "media",
      client: clientFor(
        new Map([["media/v1080/init.mp4", 1024]]),
        headObjectInputs
      ),
      committedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("reconciled");
    if (result.status !== "reconciled") {
      throw new Error("expected reconciliation result");
    }

    expect(result.results.map((entry) => entry.status)).toEqual([
      "committed",
      "failed",
    ]);
    expect(result.results[1]).toMatchObject({
      error: "missing object: media/v1080/3810.m4s",
      status: "failed",
    });
    expect(summarizeStoredS3CoordinatorUploadReconciliation(result)).toEqual({
      committed: 1,
      failed: 1,
      failedErrorCodes: [],
      failedSlotIds: ["slot_3810"],
      idempotent: 0,
      ok: false,
      planned: 2,
      slotIds: ["slot_init", "slot_3810"],
      status: "reconciled",
    });
  });

  test("summarizes missing reconciliation results", () => {
    expect(
      summarizeStoredS3CoordinatorUploadReconciliation({
        status: "not_found",
      })
    ).toEqual({
      committed: 0,
      failed: 0,
      failedErrorCodes: [],
      failedSlotIds: [],
      idempotent: 0,
      ok: false,
      planned: 0,
      slotIds: [],
      status: "not_found",
    });
  });

  test("summarizes idempotent reconciliation results", () => {
    const [slot] = stateWithSlots().slots;

    if (slot === undefined) {
      throw new Error("expected reconciliation slot fixture");
    }

    expect(
      summarizeStoredS3CoordinatorUploadReconciliation({
        results: [
          {
            commit: {
              status: "idempotent",
            } as StoredS3CoordinatorUploadReconciliationCommit,
            slot,
            status: "idempotent",
          },
        ],
        status: "reconciled",
      })
    ).toEqual({
      committed: 0,
      failed: 0,
      failedErrorCodes: [],
      failedSlotIds: [],
      idempotent: 1,
      ok: true,
      planned: 1,
      slotIds: [slot.slotId],
      status: "reconciled",
    });
  });

  test("summarizes mixed reconciliation result contributions", () => {
    const [initSlot, segmentSlot] = stateWithSlots().slots;

    if (initSlot === undefined || segmentSlot === undefined) {
      throw new Error("expected reconciliation slot fixtures");
    }

    expect(
      summarizeStoredS3CoordinatorUploadReconciliation({
        results: [
          {
            commit: {
              status: "committed",
            } as StoredS3CoordinatorUploadReconciliationCommit,
            slot: initSlot,
            status: "committed",
          },
          {
            commit: {
              status: "idempotent",
            } as StoredS3CoordinatorUploadReconciliationCommit,
            slot: segmentSlot,
            status: "idempotent",
          },
          {
            result: {
              error: {
                error: {
                  code: "olos.quota_exceeded",
                  message: "tenant quota exceeded",
                },
              },
              state: createEmptyCoordinatorState(),
              status: "rejected",
            },
            slot: segmentSlot,
            status: "failed",
          },
        ],
        status: "reconciled",
      })
    ).toEqual({
      committed: 1,
      failed: 1,
      failedErrorCodes: ["olos.quota_exceeded"],
      failedSlotIds: [segmentSlot.slotId],
      idempotent: 1,
      ok: false,
      planned: 3,
      slotIds: [initSlot.slotId, segmentSlot.slotId, segmentSlot.slotId],
      status: "reconciled",
    });
  });

  test("rejects invalid S3 reconciliation options before object observation", async () => {
    const headObjectInputs: unknown[] = [];
    const store = createMemoryCoordinatorStore();

    await saveReconciliationState(store);

    const options = {
      bucket: "media",
      client: clientFor(new Map(), headObjectInputs),
      committedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      sessionId: session.sessionId,
      store,
    };

    await expect(
      reconcileStoredS3CoordinatorUploads({ ...options, bucket: "" })
    ).rejects.toThrow("bucket must be a non-empty string");
    await expect(
      reconcileStoredS3CoordinatorUploads({ ...options, bucket: "media/live" })
    ).rejects.toThrow("bucket must not contain path separators");
    await expect(
      reconcileStoredS3CoordinatorUploads({
        ...options,
        providerId: "../provider",
      })
    ).rejects.toThrow("providerId must be a non-empty URL-safe identifier");
    expect(headObjectInputs).toEqual([]);
  });
});

async function saveReconciliationState(
  store: ReturnType<typeof createMemoryCoordinatorStore>
): Promise<void> {
  savedStoreResult(
    await store.save({
      sessionId: session.sessionId,
      state: stateWithSlots(),
    }),
    "expected reconciliation setup save"
  );
}

function stateWithSlots(): CoordinatorPipelineState {
  let state = createEmptyCoordinatorState();

  state = issueCoordinatorSlot({
    contentType: "video/mp4",
    deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
    duration: 1,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: "init",
    maxBytes: 2048,
    mediaSequenceNumber: 0,
    objectKey: "media/v1080/init.mp4",
    renditionId: "v1080",
    slotId: "slot_init",
    state,
  }).state;

  return issueCoordinatorSlot({
    contentType: "video/mp4",
    deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
    duration: 2,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: "segment",
    maxBytes: 100_000,
    mediaSequenceNumber: 3810,
    objectKey: "media/v1080/3810.m4s",
    renditionId: "v1080",
    slotId: "slot_3810",
    state,
  }).state;
}

function clientFor(
  objects: ReadonlyMap<string, number>,
  inputs: unknown[]
): S3HeadObjectClient {
  return createTestHeadObjectClientFor(
    inputs,
    (objectKey) => objects.get(objectKey),
    {},
    {},
    {
      missingObjectError: (objectKey) => `missing object: ${objectKey}`,
    }
  );
}
