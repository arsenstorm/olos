import { describe, expect, test } from "bun:test";

import {
  commitCoordinatorUpload,
  createMemoryCoordinatorStore,
  issueCoordinatorSlot,
} from "../protocol";
import type {
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineStore,
} from "../protocol/coordinator";
import {
  createEmptyCoordinatorState,
  testCoordinatorSession as session,
} from "../protocol/coordinator-state.test-helper";
import { savedStoreResult } from "../protocol/test-store.test-helper";
import { createObservedUpload } from "../state/observed-upload";
import {
  commitStoredCoordinatorUploadFromRequest,
  issueStoredCoordinatorSlotFromRequest,
  serveStoredBlockingCoordinatorManifest,
  serveStoredCoordinatorManifest,
} from "./stored";

const MEDIA_ORIGIN = "https://media.example.com";

describe("stored runtime mutations", () => {
  test("issues a slot and saves the updated coordinator state", async () => {
    const store = await createSeededStore();

    const result = await issueStoredCoordinatorSlotFromRequest({
      request: slotPayload(),
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("issued");

    if (result.status !== "issued") {
      throw new Error("expected issued slot");
    }

    const snapshot = await store.load(session.sessionId);
    expect(result.response.status).toBe(201);

    if (snapshot === undefined) {
      throw new Error("expected saved coordinator state");
    }

    expect(result.etag).toBe(snapshot?.etag);
    expect(snapshot?.state.slots).toHaveLength(1);
    expect(snapshot?.state.slots[0]?.slotId).toBe("slot_3810");
  });

  test("commits an upload and saves the updated coordinator state", async () => {
    const store = await createReadyStore();

    const result = await commitStoredCoordinatorUploadFromRequest({
      request: commitPayload(),
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("committed");

    if (result.status !== "committed") {
      throw new Error("expected committed upload");
    }

    const snapshot = await store.load(session.sessionId);
    expect(result.response.status).toBe(201);

    if (snapshot === undefined) {
      throw new Error("expected saved coordinator state");
    }

    expect(result.etag).toBe(snapshot?.etag);
    expect(snapshot?.state.commits).toHaveLength(1);
    expect(snapshot?.state.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
  });

  test("returns idempotent stored commits without duplicating state", async () => {
    const store = await createReadyStore();
    const first = await commitStoredCoordinatorUploadFromRequest({
      request: commitPayload(),
      sessionId: session.sessionId,
      store,
    });
    const second = await commitStoredCoordinatorUploadFromRequest({
      request: commitPayload(),
      sessionId: session.sessionId,
      store,
    });
    const snapshot = await store.load(session.sessionId);

    expect(first.status).toBe("committed");
    expect(second.status).toBe("idempotent");
    expect(second.response.status).toBe(200);
    expect(snapshot?.state.commits).toHaveLength(1);
    expect(snapshot?.state.commits[0]).toMatchObject({
      commitId: "commit_3810",
      objectKey: "media/s3810.m4s",
      slotId: "slot_3810",
    });
    expect(snapshot?.state.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
  });

  test("returns app-owned commit policy rejections without saving", async () => {
    const store = await createReadyStore();
    const result = await commitStoredCoordinatorUploadFromRequest({
      commitPolicy: ({ slot }) => ({
        error: {
          error: {
            code: "olos.security_policy_violation",
            details: { publisherInstanceId: slot.publisherInstanceId },
            message: "publisher is not authorised",
          },
        },
        status: "rejected",
      }),
      request: commitPayload(),
      sessionId: session.sessionId,
      store,
    });
    const snapshot = await store.load(session.sessionId);

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected rejected commit");
    }

    expect(result.response.status).toBe(409);
    expect(await result.response.json()).toEqual({
      error: {
        code: "olos.security_policy_violation",
        details: { publisherInstanceId: "pub_1" },
        message: "publisher is not authorised",
      },
    });
    expect(snapshot?.state.commits).toHaveLength(0);
    expect(snapshot?.state.slots.at(-1)?.state).toBe("issued");
  });

  test("returns not found responses for missing coordinator sessions", async () => {
    const result = await issueStoredCoordinatorSlotFromRequest({
      request: slotPayload(),
      sessionId: "missing",
      store: createMemoryCoordinatorStore(),
    });

    expect(result.status).toBe("not_found");
    expect(result.response.status).toBe(404);
  });

  test("rejects invalid stored mutation attempt limits", async () => {
    const store = await createReadyStore();

    await expect(
      issueStoredCoordinatorSlotFromRequest({
        maxAttempts: 0,
        request: slotPayload(),
        sessionId: session.sessionId,
        store,
      })
    ).rejects.toThrow("maxAttempts must be a positive integer");
    await expect(
      commitStoredCoordinatorUploadFromRequest({
        maxAttempts: 1.5,
        request: commitPayload(),
        sessionId: session.sessionId,
        store,
      })
    ).rejects.toThrow("maxAttempts must be a positive integer");
  });

  test("retries issue mutations after save conflicts with current state", async () => {
    const store = await createConflictingStore();

    const result = await issueStoredCoordinatorSlotFromRequest({
      request: slotPayload(),
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("issued");

    if (result.status !== "issued") {
      throw new Error("expected issued slot after conflict retry");
    }

    expect(result.response.status).toBe(201);
    expect(result.state.slots).toHaveLength(2);
    expect(result.state.slots.map((slot) => slot.slotId)).toEqual([
      "slot_existing",
      "slot_3810",
    ]);
  });

  test("retries commit mutations after save conflicts with current state", async () => {
    const store = await createCommitConflictingStore();

    const result = await commitStoredCoordinatorUploadFromRequest({
      request: commitPayload(),
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("committed");

    if (result.status !== "committed") {
      throw new Error("expected committed upload after conflict retry");
    }

    expect(result.response.status).toBe(201);
    expect(result.state.slots.map((slot) => slot.slotId)).toEqual([
      "slot_init",
      "slot_3810",
      "slot_3811",
    ]);
    expect(result.state.commits).toHaveLength(1);
    expect(result.state.commits[0]).toMatchObject({
      commitId: "commit_3810",
      objectKey: "media/s3810.m4s",
      slotId: "slot_3810",
    });
  });

  test("returns conflict responses when save conflicts cannot be retried", async () => {
    const store = await createConflictOnlyStore();

    const result = await issueStoredCoordinatorSlotFromRequest({
      request: slotPayload(),
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("conflict");

    if (result.status !== "conflict") {
      throw new Error("expected conflict result");
    }

    expect(result.response.status).toBe(409);
    expect(await result.response.json()).toEqual({
      error: { message: "coordinator session changed during mutation" },
    });
  });

  test("serves manifests from stored coordinator state", async () => {
    const store = await createReadyStore();

    const result = await commitStoredCoordinatorUploadFromRequest({
      request: commitPayload(),
      sessionId: session.sessionId,
      store,
    });

    expect(result.status).toBe("committed");

    const response = await serveStoredCoordinatorManifest({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: session.partTarget,
      request: "https://edge.example.com/v1/live/session_1/v1080/media.m3u8",
      segmentTarget: session.segmentTarget,
      sessionId: session.sessionId,
      store,
      targetLatency: 3,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.apple.mpegurl"
    );
    expect(await response.text()).toContain(
      "https://media.example.com/s3810.m4s"
    );
  });

  test("returns manifest not found responses for missing stored manifests", async () => {
    const response = await serveStoredCoordinatorManifest({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: session.partTarget,
      request: "https://edge.example.com/v1/live/missing/v1080/media.m3u8",
      segmentTarget: session.segmentTarget,
      sessionId: "missing",
      store: createMemoryCoordinatorStore(),
      targetLatency: 3,
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("manifest not found");
  });

  test("serves blocking manifests from stored coordinator state", async () => {
    const store = await createReadyStore();

    await commitStoredCoordinatorUploadFromRequest({
      request: commitPayload(),
      sessionId: session.sessionId,
      store,
    });

    const response = await serveStoredBlockingCoordinatorManifest({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      partTarget: session.partTarget,
      request:
        "https://edge.example.com/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3810",
      segmentTarget: session.segmentTarget,
      sessionId: session.sessionId,
      store,
      targetLatency: 3,
      timeoutMs: 100,
      waitForCursor: () =>
        Promise.reject(new Error("waiter should not be called")),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("#EXT-X-MEDIA-SEQUENCE:3810");
  });
});

async function createSeededStore(): Promise<CoordinatorPipelineStore> {
  const store = createMemoryCoordinatorStore();
  const saved = await store.save({
    sessionId: session.sessionId,
    state: createEmptyCoordinatorState(),
  });

  savedStoreResult(saved, "expected seeded coordinator state");

  return store;
}

async function createConflictingStore(): Promise<CoordinatorPipelineStore> {
  const store = await createSeededStore();
  const originalSave = store.save;
  const currentState = issueCoordinatorSlot({
    ...slotPayload(),
    deliveryUrl: "https://media.example.com/existing.m4s",
    objectKey: "media/existing.m4s",
    slotId: "slot_existing",
    state: createEmptyCoordinatorState(),
  }).state;
  let conflicted = false;

  return {
    load: store.load,
    save: async (options) => {
      if (!conflicted) {
        conflicted = true;
        const current = await store.load(session.sessionId);

        if (current === undefined) {
          throw new Error("expected seeded coordinator snapshot");
        }

        const saved = await originalSave({
          expectedEtag: current.etag,
          sessionId: session.sessionId,
          state: currentState,
        });

        const savedState = savedStoreResult(
          saved,
          "expected external coordinator save"
        );

        return {
          current: {
            etag: savedState.etag,
            state: savedState.state,
          },
          status: "conflict",
        };
      }

      return await originalSave(options);
    },
  };
}

async function createCommitConflictingStore(): Promise<CoordinatorPipelineStore> {
  const store = await createReadyStore();
  const originalSave = store.save;
  let conflicted = false;

  return {
    load: store.load,
    save: async (options) => {
      if (!conflicted) {
        conflicted = true;
        const current = await store.load(session.sessionId);

        if (current === undefined) {
          throw new Error("expected ready coordinator snapshot");
        }

        const next = issueCoordinatorSlot({
          ...slotPayload(),
          deliveryUrl: "https://media.example.com/s3811.m4s",
          mediaSequenceNumber: 3811,
          objectKey: "media/s3811.m4s",
          slotId: "slot_3811",
          state: current.state,
        });
        const saved = await originalSave({
          expectedEtag: current.etag,
          sessionId: session.sessionId,
          state: next.state,
        });

        const savedState = savedStoreResult(
          saved,
          "expected external coordinator save"
        );

        return {
          current: {
            etag: savedState.etag,
            state: savedState.state,
          },
          status: "conflict",
        };
      }

      return await originalSave(options);
    },
  };
}

async function createConflictOnlyStore(): Promise<CoordinatorPipelineStore> {
  const snapshot = await createSeededSnapshot();

  return {
    load: async () => snapshot,
    save: async () => ({ status: "conflict" }),
  };
}

async function createSeededSnapshot(): Promise<CoordinatorPipelineSnapshot> {
  const store = await createSeededStore();
  const snapshot = await store.load(session.sessionId);

  if (snapshot === undefined) {
    throw new Error("expected seeded coordinator snapshot");
  }

  return snapshot;
}

async function createReadyStore(): Promise<CoordinatorPipelineStore> {
  const store = createMemoryCoordinatorStore();
  const state = createEmptyCoordinatorState();
  const init = issueCoordinatorSlot({
    contentType: "video/mp4",
    deliveryUrl: "https://media.example.com/init.mp4",
    duration: 1,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: "init",
    maxBytes: 2048,
    mediaSequenceNumber: 0,
    objectKey: "media/init.mp4",
    publicationMode: "direct-public",
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
    slotId: "slot_init",
    state,
  });
  const initCommit = commitCoordinatorUpload({
    commitId: "commit_init",
    committedAt: "2026-01-01T00:00:02.000Z",
    object: createObservedUpload({
      contentType: "video/mp4",
      objectKey: "media/init.mp4",
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: 1024,
    }),
    slotId: "slot_init",
    state: init.state,
  });

  if (initCommit.status !== "committed") {
    throw new Error("expected committed init");
  }

  const slot = issueCoordinatorSlot({
    ...slotPayload(),
    state: initCommit.state,
  });
  const saved = await store.save({
    sessionId: session.sessionId,
    state: slot.state,
  });

  savedStoreResult(saved, "expected ready coordinator state");

  return store;
}

function slotPayload() {
  return {
    contentType: "video/mp4",
    deliveryUrl: "https://media.example.com/s3810.m4s",
    duration: 2,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: "segment" as const,
    maxBytes: 100_000,
    mediaSequenceNumber: 3810,
    objectKey: "media/s3810.m4s",
    publicationMode: "direct-public" as const,
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
    slotId: "slot_3810",
  };
}

function commitPayload() {
  return {
    commitId: "commit_3810",
    committedAt: "2026-01-01T00:00:02.000Z",
    independent: true,
    object: {
      contentType: "video/mp4",
      objectKey: "media/s3810.m4s",
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: 98_304,
    },
    slotId: "slot_3810",
  };
}
