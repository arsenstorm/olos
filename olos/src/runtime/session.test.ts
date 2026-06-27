import { describe, expect, test } from "bun:test";

import {
  type CoordinatorPipelineStore,
  createCoordinatorPipeline,
  createMemoryCoordinatorStore,
} from "../protocol";
import type { CoordinatorPipelineState } from "../protocol/coordinator";
import {
  TEST_COORDINATOR_MEDIA_BASE_URL as mediaBaseUrl,
  testCoordinatorSession,
} from "../protocol/coordinator-state.test-helper";
import { savedStoreResult } from "../protocol/test-store.test-helper";
import type { Cursor } from "../types/cursor";
import type { Session } from "../types/session";
import {
  createStoredCoordinatorSession,
  heartbeatStoredCoordinatorPublisher,
  transitionStoredCoordinatorSession,
} from "./session";

const session: Session = { ...testCoordinatorSession, state: "created" };

describe("stored session runtime", () => {
  test("creates and stores coordinator session state", async () => {
    const store = createMemoryCoordinatorStore();

    const result = await createStoredCoordinatorSession({
      mediaBaseUrl,
      session,
      store,
    });

    expect(result.status).toBe("created");

    if (result.status !== "created") {
      throw new Error("expected created session");
    }

    const snapshot = await store.load(session.sessionId);
    expect(result.response.status).toBe(201);

    if (snapshot === undefined) {
      throw new Error("expected stored coordinator session");
    }

    expect(result.etag).toBe(snapshot.etag);
    expect(snapshot.state.session).toEqual(session);
    expect(snapshot.state.mediaBaseUrl).toBe(mediaBaseUrl);
  });

  test("rejects duplicate coordinator session creation", async () => {
    const store = createMemoryCoordinatorStore();
    await seedCreatedSession(store);

    const result = await createStoredCoordinatorSession({
      mediaBaseUrl,
      session,
      store,
    });

    expect(result.status).toBe("conflict");
    expect(result.response.status).toBe(409);
  });

  test("transitions stored coordinator sessions", async () => {
    const store = createMemoryCoordinatorStore();
    await seedCreatedSession(store);

    const result = await transitionStoredCoordinatorSession({
      sessionId: session.sessionId,
      state: "starting",
      store,
    });

    expect(result.status).toBe("transitioned");

    if (result.status !== "transitioned") {
      throw new Error("expected session transition");
    }

    const snapshot = await store.load(session.sessionId);
    expect(result.response.status).toBe(200);
    expect(result.state.session.state).toBe("starting");
    expect(result.state.cursor).toBeUndefined();
    expect(snapshot?.state.session.state).toBe("starting");
  });

  test("keeps cursor state aligned with session state", async () => {
    const store = createMemoryCoordinatorStore();
    await seedStore(store, {
      ...createCoordinatorPipeline({
        mediaBaseUrl,
        session: { ...session, state: "live" },
      }),
      cursor: cursor("live"),
    });

    const result = await transitionStoredCoordinatorSession({
      sessionId: session.sessionId,
      state: "ending",
      store,
    });

    expect(result.status).toBe("transitioned");

    if (result.status !== "transitioned") {
      throw new Error("expected session transition");
    }

    expect(result.state.session.state).toBe("ending");
    expect(result.state.cursor?.state).toBe("ending");
  });

  test("stores and refreshes publisher heartbeats", async () => {
    const store = createMemoryCoordinatorStore();
    await seedCreatedSession(store);

    const first = await heartbeatStoredCoordinatorPublisher({
      now: "2026-01-01T00:00:01.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
      store,
      ttlMs: 3000,
    });
    const second = await heartbeatStoredCoordinatorPublisher({
      now: "2026-01-01T00:00:02.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
      store,
      ttlMs: 3000,
    });

    expect(first.status).toBe("refreshed");
    expect(second.status).toBe("refreshed");

    if (second.status !== "refreshed") {
      throw new Error("expected refreshed heartbeat");
    }

    const snapshot = await store.load(session.sessionId);

    expect(second.response.status).toBe(200);
    expect(second.lease).toEqual({
      expiresAt: "2026-01-01T00:00:05.000Z",
      issuedAt: "2026-01-01T00:00:01.000Z",
      lastSeenAt: "2026-01-01T00:00:02.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
      tenantId: session.tenantId,
    });
    expect(snapshot?.state.publisherLeases).toEqual([second.lease]);
  });

  test("refreshes one publisher heartbeat without dropping other leases", async () => {
    const store = createMemoryCoordinatorStore();
    await seedCreatedSession(store);

    const firstPublisher = await heartbeatStoredCoordinatorPublisher({
      now: "2026-01-01T00:00:01.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
      store,
      ttlMs: 3000,
    });
    const secondPublisher = await heartbeatStoredCoordinatorPublisher({
      now: "2026-01-01T00:00:01.500Z",
      publisherInstanceId: "publisher_2",
      sessionId: session.sessionId,
      store,
      ttlMs: 3000,
    });
    const refreshedFirstPublisher = await heartbeatStoredCoordinatorPublisher({
      now: "2026-01-01T00:00:02.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
      store,
      ttlMs: 3000,
    });

    expect(firstPublisher.status).toBe("refreshed");
    expect(secondPublisher.status).toBe("refreshed");
    expect(refreshedFirstPublisher.status).toBe("refreshed");

    if (
      secondPublisher.status !== "refreshed" ||
      refreshedFirstPublisher.status !== "refreshed"
    ) {
      throw new Error("expected refreshed publisher heartbeats");
    }

    const snapshot = await store.load(session.sessionId);

    expect(snapshot?.state.publisherLeases).toEqual([
      secondPublisher.lease,
      refreshedFirstPublisher.lease,
    ]);
  });

  test("rejects publisher heartbeats for terminal sessions", async () => {
    const store = createMemoryCoordinatorStore();
    await seedStore(
      store,
      createCoordinatorPipeline({
        mediaBaseUrl,
        session: { ...session, state: "ended" },
      })
    );

    const result = await heartbeatStoredCoordinatorPublisher({
      now: "2026-01-01T00:00:01.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
      store,
      ttlMs: 3000,
    });

    expect(result.status).toBe("rejected");
    expect(result.response.status).toBe(409);
  });

  test("rejects invalid stored session transitions", async () => {
    const store = createMemoryCoordinatorStore();
    await seedCreatedSession(store);

    const result = await transitionStoredCoordinatorSession({
      sessionId: session.sessionId,
      state: "ended",
      store,
    });

    expect(result.status).toBe("rejected");
    expect(result.response.status).toBe(409);
    expect(await result.response.json()).toEqual({
      error: { message: "Invalid session transition: created -> ended" },
    });
  });

  test("rejects invalid stored session transition options", async () => {
    const store = createMemoryCoordinatorStore();

    const invalidSessionId = await transitionStoredCoordinatorSession({
      sessionId: "../session",
      state: "starting",
      store,
    });
    const invalidState = await transitionStoredCoordinatorSession({
      sessionId: session.sessionId,
      state: "paused" as never,
      store,
    });

    expect(invalidSessionId.status).toBe("rejected");
    expect(invalidSessionId.response.status).toBe(409);
    expect(await invalidSessionId.response.json()).toEqual({
      error: { message: "sessionId must be a non-empty URL-safe identifier" },
    });

    expect(invalidState.status).toBe("rejected");
    expect(invalidState.response.status).toBe(409);
    expect(await invalidState.response.json()).toEqual({
      error: {
        message:
          "state must be one of: created, starting, live, ending, ended, aborted, expired",
      },
    });
  });

  test("rejects invalid stored session transition options before loading state", async () => {
    const store = countingStore();

    const result = await transitionStoredCoordinatorSession({
      sessionId: "../session",
      state: "starting",
      store,
    });

    expect(result.status).toBe("rejected");
    expect(store.loads).toBe(0);
  });

  test("returns not found for missing stored session transitions", async () => {
    const result = await transitionStoredCoordinatorSession({
      sessionId: "missing",
      state: "starting",
      store: createMemoryCoordinatorStore(),
    });

    expect(result.status).toBe("not_found");
    expect(result.response.status).toBe(404);
  });

  test("returns not found for missing publisher heartbeat sessions", async () => {
    const result = await heartbeatStoredCoordinatorPublisher({
      now: "2026-01-01T00:00:01.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: "missing",
      store: createMemoryCoordinatorStore(),
      ttlMs: 3000,
    });

    expect(result.status).toBe("not_found");
    expect(result.response.status).toBe(404);
  });

  test("rejects invalid publisher heartbeat options before loading state", async () => {
    const store = countingStore();

    const result = await heartbeatStoredCoordinatorPublisher({
      now: "soon",
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
      store,
      ttlMs: 3000,
    });

    expect(result.status).toBe("rejected");
    expect(store.loads).toBe(0);
  });

  test("rejects invalid publisher heartbeat options", async () => {
    const store = createMemoryCoordinatorStore();

    const invalidPublisher = await heartbeatStoredCoordinatorPublisher({
      now: "2026-01-01T00:00:01.000Z",
      publisherInstanceId: "../publisher",
      sessionId: session.sessionId,
      store,
      ttlMs: 3000,
    });
    const invalidNow = await heartbeatStoredCoordinatorPublisher({
      now: "soon",
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
      store,
      ttlMs: 3000,
    });
    const invalidTtl = await heartbeatStoredCoordinatorPublisher({
      now: "2026-01-01T00:00:01.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
      store,
      ttlMs: 0,
    });

    expect(invalidPublisher.status).toBe("rejected");
    expect(invalidPublisher.response.status).toBe(409);
    expect(await invalidPublisher.response.json()).toEqual({
      error: {
        message: "publisherInstanceId must be a non-empty URL-safe identifier",
      },
    });

    expect(invalidNow.status).toBe("rejected");
    expect(invalidNow.response.status).toBe(409);
    expect(await invalidNow.response.json()).toEqual({
      error: { message: "now must be a valid timestamp" },
    });

    expect(invalidTtl.status).toBe("rejected");
    expect(invalidTtl.response.status).toBe(409);
    expect(await invalidTtl.response.json()).toEqual({
      error: { message: "ttlMs must be a positive number" },
    });
  });
});

async function seedCreatedSession(
  store: ReturnType<typeof createMemoryCoordinatorStore>
): Promise<void> {
  await seedStore(store, createCoordinatorPipeline({ mediaBaseUrl, session }));
}

async function seedStore(
  store: ReturnType<typeof createMemoryCoordinatorStore>,
  state: CoordinatorPipelineState
): Promise<void> {
  const saved = await store.save({
    sessionId: state.session.sessionId,
    state,
  });

  savedStoreResult(saved, "expected seeded coordinator state");
}

function countingStore(): CoordinatorPipelineStore & {
  readonly loads: number;
} {
  let loads = 0;

  return {
    get loads() {
      return loads;
    },
    load: () => {
      loads += 1;
      return Promise.resolve(undefined);
    },
    save: () => {
      throw new Error("store save should not be called");
    },
  };
}

function cursor(state: Cursor["state"]): Cursor {
  return {
    committedWindow: {
      discontinuitySequence: 0,
      epoch: session.epoch,
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
      renditions: {
        v1080: {
          init: {
            commitId: "commit_init",
            deliveryUrl: "https://media.example.com/init.mp4",
            objectKey: "media/init.mp4",
            slotId: "slot_init",
          },
          renditionId: "v1080",
          segments: [
            {
              duration: 2,
              independent: true,
              mediaSequenceNumber: 3810,
              segment: {
                commitId: "commit_3810",
                deliveryUrl: "https://media.example.com/s3810.m4s",
                objectKey: "media/s3810.m4s",
                slotId: "slot_3810",
              },
            },
          ],
        },
      },
    },
    epoch: session.epoch,
    latencyProfile: session.latencyProfile,
    olos: "1.0",
    mediaBaseUrl: "https://media.example.com",
    partTarget: session.partTarget,
    segmentTarget: session.segmentTarget,
    sessionId: session.sessionId,
    state,
    tenantId: session.tenantId,
    updatedAt: "2026-01-01T00:00:02.000Z",
    window: {
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    },
  };
}
