import { describe, expect, test } from "bun:test";
import { createMemoryCoordinatorStore } from "../protocol/coordinator-memory-store";
import {
  createEmptyCoordinatorState,
  testCoordinatorSession as session,
} from "../protocol/coordinator-state.test-helper";
import { savedStoreResult } from "../protocol/test-store.test-helper";
import { runRuntimePublisherUploadStep } from "./publisher";
import { resolveRuntimePublisherLoopDecision } from "./publisher-steps";
import {
  commitStoredCoordinatorUploadFromRequest,
  issueStoredCoordinatorSlotFromRequest,
} from "./stored";

describe("runtime publisher upload step", () => {
  test("resolves publisher loop decisions from step status", () => {
    expect(
      resolveRuntimePublisherLoopDecision({
        attempt: 0,
        maxAttempts: 3,
        step: { status: "committed" },
      })
    ).toEqual({ action: "continue" });
    expect(
      resolveRuntimePublisherLoopDecision({
        attempt: 1,
        maxAttempts: 3,
        step: { status: "upload_failed" },
      })
    ).toEqual({
      action: "retry",
      nextAttempt: 2,
    });
    expect(
      resolveRuntimePublisherLoopDecision({
        attempt: 2,
        maxAttempts: 3,
        step: { status: "commit_failed" },
      })
    ).toEqual({
      action: "stop",
      reason: "attempts_exhausted",
    });
  });

  test("rejects invalid publisher loop decision inputs", () => {
    expect(() =>
      resolveRuntimePublisherLoopDecision({
        attempt: -1,
        maxAttempts: 3,
        step: { status: "issue_failed" },
      })
    ).toThrow("attempt must be a non-negative integer");
    expect(() =>
      resolveRuntimePublisherLoopDecision({
        attempt: 0,
        maxAttempts: 0,
        step: { status: "issue_failed" },
      })
    ).toThrow("maxAttempts must be a positive integer");
    expect(() =>
      resolveRuntimePublisherLoopDecision({
        attempt: 0,
        maxAttempts: 3,
        step: { status: "unknown" as "issue_failed" },
      })
    ).toThrow("publisher step status is unsupported");
  });

  test("issues, uploads, and commits one publisher segment", async () => {
    const store = createMemoryCoordinatorStore();
    await seedSession(store);
    await seedInitUpload(store);

    const step = await runRuntimePublisherUploadStep({
      commit: (request) =>
        commitStoredCoordinatorUploadFromRequest({
          request,
          sessionId: session.sessionId,
          store,
        }),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      issueSlot: (request) =>
        issueStoredCoordinatorSlotFromRequest({
          request,
          sessionId: session.sessionId,
          store,
        }),
      profile: { independent: true },
      slot: slotPayload({
        duration: 2,
        kind: "segment",
        maxBytes: 100_000,
        sequenceNumber: 3810,
        slotId: "slot_3810",
      }),
      upload: (slot) =>
        Promise.resolve({
          contentType: slot.contentType,
          objectKey: slot.objectKey,
          observedAt: "2026-01-01T00:00:02.000Z",
          providerId: "s3_primary",
          size: 98_304,
        }),
    });
    const snapshot = await store.load(session.sessionId);

    expect(step.status).toBe("committed");
    expect(snapshot?.state.cursor?.window).toEqual({
      firstSequenceNumber: 3810,
      lastSequenceNumber: 3810,
    });
  });

  test("sends a publisher heartbeat before upload work", async () => {
    const store = createMemoryCoordinatorStore();
    await seedSession(store);
    let heartbeats = 0;

    const step = await runRuntimePublisherUploadStep({
      commit: () => Promise.resolve({ status: "committed" }),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      heartbeat: () => {
        heartbeats += 1;

        return Promise.resolve({ status: "refreshed" });
      },
      issueSlot: (request) =>
        issueStoredCoordinatorSlotFromRequest({
          request,
          sessionId: session.sessionId,
          store,
        }),
      slot: slotPayload({
        duration: 2,
        kind: "segment",
        maxBytes: 100_000,
        sequenceNumber: 3810,
        slotId: "slot_3810",
      }),
      upload: (slot) =>
        Promise.resolve({
          contentType: slot.contentType,
          objectKey: slot.objectKey,
          observedAt: "2026-01-01T00:00:02.000Z",
          providerId: "s3_primary",
          size: 98_304,
        }),
    });

    expect(heartbeats).toBe(1);
    expect(step).toMatchObject({
      heartbeat: { status: "refreshed" },
      status: "committed",
    });
  });

  test("stops before slot issuance when publisher heartbeat fails", async () => {
    let issued = false;

    const step = await runRuntimePublisherUploadStep({
      commit: () => Promise.resolve({ status: "should_not_commit" }),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      heartbeat: () => Promise.resolve({ status: "stale" }),
      issueSlot: () => {
        issued = true;

        return Promise.resolve({ status: "issued" });
      },
      slot: slotPayload({
        duration: 2,
        kind: "segment",
        maxBytes: 100_000,
        sequenceNumber: 3810,
        slotId: "slot_3810",
      }),
      upload: () => Promise.reject(new Error("should not upload")),
    });

    expect(issued).toBe(false);
    expect(step).toEqual({
      heartbeat: { status: "stale" },
      status: "heartbeat_failed",
    });
  });

  test("stops before slot issuance when publisher heartbeat throws", async () => {
    let issued = false;

    const step = await runRuntimePublisherUploadStep({
      commit: () => Promise.resolve({ status: "should_not_commit" }),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      heartbeat: () => Promise.reject(new Error("heartbeat unavailable")),
      issueSlot: () => {
        issued = true;

        return Promise.resolve({ status: "issued" });
      },
      slot: slotPayload({
        duration: 2,
        kind: "segment",
        maxBytes: 100_000,
        sequenceNumber: 3810,
        slotId: "slot_3810",
      }),
      upload: () => Promise.reject(new Error("should not upload")),
    });

    expect(issued).toBe(false);
    expect(step).toEqual({
      error: "heartbeat unavailable",
      status: "heartbeat_failed",
    });
  });

  test("stops before commit when publisher upload fails", async () => {
    const store = createMemoryCoordinatorStore();
    await seedSession(store);

    const step = await runRuntimePublisherUploadStep({
      commit: () => Promise.resolve({ status: "should_not_commit" }),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      issueSlot: (request) =>
        issueStoredCoordinatorSlotFromRequest({
          request,
          sessionId: session.sessionId,
          store,
        }),
      slot: slotPayload({
        duration: 2,
        kind: "segment",
        maxBytes: 100_000,
        sequenceNumber: 3810,
        slotId: "slot_3810",
      }),
      upload: () => Promise.reject(new Error("upload failed")),
    });

    expect(step).toMatchObject({
      error: "upload failed",
      status: "upload_failed",
    });
  });

  test("keeps heartbeat context when upload fails", async () => {
    const store = createMemoryCoordinatorStore();
    await seedSession(store);

    const step = await runRuntimePublisherUploadStep({
      commit: () => Promise.resolve({ status: "should_not_commit" }),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      heartbeat: () => Promise.resolve({ status: "refreshed" }),
      issueSlot: (request) =>
        issueStoredCoordinatorSlotFromRequest({
          request,
          sessionId: session.sessionId,
          store,
        }),
      slot: slotPayload({
        duration: 2,
        kind: "segment",
        maxBytes: 100_000,
        sequenceNumber: 3810,
        slotId: "slot_3810",
      }),
      upload: () => Promise.reject(new Error("upload unavailable")),
    });

    expect(step).toMatchObject({
      error: "upload unavailable",
      heartbeat: { status: "refreshed" },
      status: "upload_failed",
    });
  });

  test("returns issue failure when slot issuance throws", async () => {
    const step = await runRuntimePublisherUploadStep({
      commit: () => Promise.resolve({ status: "should_not_commit" }),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      issueSlot: () => Promise.reject(new Error("slot unavailable")),
      slot: slotPayload({
        duration: 2,
        kind: "segment",
        maxBytes: 100_000,
        sequenceNumber: 3810,
        slotId: "slot_3810",
      }),
      upload: () => Promise.reject(new Error("should not upload")),
    });

    expect(step).toEqual({
      error: "slot unavailable",
      status: "issue_failed",
    });
  });

  test("returns issue failure when slot issuance does not issue a slot", async () => {
    const step = await runRuntimePublisherUploadStep({
      commit: () => Promise.resolve({ status: "should_not_commit" }),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      issueSlot: () => Promise.resolve({ status: "rejected" }),
      slot: slotPayload({
        duration: 2,
        kind: "segment",
        maxBytes: 100_000,
        sequenceNumber: 3810,
        slotId: "slot_3810",
      }),
      upload: () => Promise.reject(new Error("should not upload")),
    });

    expect(step).toEqual({
      issue: { status: "rejected" },
      status: "issue_failed",
    });
  });

  test("returns commit failure when commit throws", async () => {
    const store = createMemoryCoordinatorStore();
    await seedSession(store);

    const step = await runRuntimePublisherUploadStep({
      commit: () => Promise.reject(new Error("commit unavailable")),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      issueSlot: (request) =>
        issueStoredCoordinatorSlotFromRequest({
          request,
          sessionId: session.sessionId,
          store,
        }),
      slot: slotPayload({
        duration: 2,
        kind: "segment",
        maxBytes: 100_000,
        sequenceNumber: 3810,
        slotId: "slot_3810",
      }),
      upload: (slot) =>
        Promise.resolve({
          contentType: slot.contentType,
          objectKey: slot.objectKey,
          observedAt: "2026-01-01T00:00:02.000Z",
          providerId: "s3_primary",
          size: 98_304,
        }),
    });

    expect(step).toMatchObject({
      error: "commit unavailable",
      status: "commit_failed",
    });
  });

  test("keeps heartbeat context when commit fails after upload", async () => {
    const store = createMemoryCoordinatorStore();
    await seedSession(store);

    const step = await runRuntimePublisherUploadStep({
      commit: () => Promise.reject(new Error("commit unavailable")),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      heartbeat: () => Promise.resolve({ status: "refreshed" }),
      issueSlot: (request) =>
        issueStoredCoordinatorSlotFromRequest({
          request,
          sessionId: session.sessionId,
          store,
        }),
      slot: slotPayload({
        duration: 2,
        kind: "segment",
        maxBytes: 100_000,
        sequenceNumber: 3810,
        slotId: "slot_3810",
      }),
      upload: (slot) =>
        Promise.resolve({
          contentType: slot.contentType,
          objectKey: slot.objectKey,
          observedAt: "2026-01-01T00:00:02.000Z",
          providerId: "s3_primary",
          size: 98_304,
        }),
    });

    expect(step).toMatchObject({
      error: "commit unavailable",
      heartbeat: { status: "refreshed" },
      status: "commit_failed",
    });
  });

  test("returns commit failure when commit returns a non-success status", async () => {
    const store = createMemoryCoordinatorStore();
    await seedSession(store);

    const step = await runRuntimePublisherUploadStep({
      commit: () => Promise.resolve({ status: "rejected" }),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      issueSlot: (request) =>
        issueStoredCoordinatorSlotFromRequest({
          request,
          sessionId: session.sessionId,
          store,
        }),
      slot: slotPayload({
        duration: 2,
        kind: "segment",
        maxBytes: 100_000,
        sequenceNumber: 3810,
        slotId: "slot_3810",
      }),
      upload: (slot) =>
        Promise.resolve({
          contentType: slot.contentType,
          objectKey: slot.objectKey,
          observedAt: "2026-01-01T00:00:02.000Z",
          providerId: "s3_primary",
          size: 98_304,
        }),
    });

    expect(step).toMatchObject({
      commit: { status: "rejected" },
      status: "commit_failed",
    });
  });

  test("returns idempotent commit results as successful steps", async () => {
    const store = createMemoryCoordinatorStore();
    await seedSession(store);

    const step = await runRuntimePublisherUploadStep({
      commit: () => Promise.resolve({ status: "idempotent" }),
      commitId: "commit_3810",
      committedAt: "2026-01-01T00:00:02.000Z",
      issueSlot: (request) =>
        issueStoredCoordinatorSlotFromRequest({
          request,
          sessionId: session.sessionId,
          store,
        }),
      slot: slotPayload({
        duration: 2,
        kind: "segment",
        maxBytes: 100_000,
        sequenceNumber: 3810,
        slotId: "slot_3810",
      }),
      upload: (slot) =>
        Promise.resolve({
          contentType: slot.contentType,
          objectKey: slot.objectKey,
          observedAt: "2026-01-01T00:00:02.000Z",
          providerId: "s3_primary",
          size: 98_304,
        }),
    });

    expect(step).toMatchObject({
      commit: { status: "idempotent" },
      status: "idempotent",
    });
  });
});

async function seedSession(
  store: ReturnType<typeof createMemoryCoordinatorStore>
): Promise<void> {
  const saved = await store.save({
    sessionId: session.sessionId,
    state: createEmptyCoordinatorState(),
  });

  savedStoreResult(saved, "expected seeded session");
}

async function seedInitUpload(
  store: ReturnType<typeof createMemoryCoordinatorStore>
): Promise<void> {
  await issueStoredCoordinatorSlotFromRequest({
    request: slotPayload({
      duration: 1,
      kind: "init",
      maxBytes: 2048,
      sequenceNumber: 0,
      slotId: "slot_init",
    }),
    sessionId: session.sessionId,
    store,
  });

  const committed = await commitStoredCoordinatorUploadFromRequest({
    request: {
      commitId: "commit_init",
      committedAt: "2026-01-01T00:00:01.000Z",
      object: {
        contentType: "video/mp4",
        objectKey: "objects/v1080/init",
        observedAt: "2026-01-01T00:00:01.000Z",
        providerId: "s3_primary",
        size: 1024,
      },
      slotId: "slot_init",
    },
    sessionId: session.sessionId,
    store,
  });

  if (committed.status !== "committed") {
    throw new Error("expected committed init upload");
  }
}

interface SlotPayloadOptions {
  duration: number;
  kind: "init" | "segment";
  maxBytes: number;
  sequenceNumber: number;
  slotId: string;
}

function slotPayload(options: SlotPayloadOptions) {
  return {
    contentType: "video/mp4",
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: options.kind,
    maxBytes: options.maxBytes,
    profile: { duration: options.duration },
    sequenceNumber: options.sequenceNumber,
    slotId: options.slotId,
    trackId: "v1080",
  };
}
