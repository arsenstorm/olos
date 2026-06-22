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
  summarizeStoredS3CoordinatorUploadReconciliation,
} from "./reconciliation";
import { createTestHeadObjectClientFor } from "./test-client.test-helper";

describe("stored S3 upload reconciliation", () => {
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
    publicationMode: "direct-public",
    publisherInstanceId: "publisher_1",
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
    publicationMode: "direct-public",
    publisherInstanceId: "publisher_1",
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
