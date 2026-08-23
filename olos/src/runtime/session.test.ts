import { describe, expect, test } from "bun:test";

import { createCoordinatorPipeline } from "../protocol/coordinator-lifecycle";
import { createMemoryCoordinatorStore } from "../protocol/coordinator-memory-store";
import {
  TEST_COORDINATOR_DELIVERY_BASE_URL as deliveryBaseUrl,
  testCoordinatorSession,
} from "../protocol/coordinator-state.test-helper";
import type {
  CoordinatorPipelineState,
  CoordinatorPipelineStore,
} from "../protocol/coordinator-types";
import { savedStoreResult } from "../protocol/test-store.test-helper";
import type { Cursor } from "../types/cursor";
import type { Session } from "../types/session";
import {
  createStoredCoordinatorSession,
  heartbeatStoredCoordinatorPublisher,
  transitionStoredCoordinatorSession,
} from "./session";

const session: Session = { ...testCoordinatorSession, state: "live" };

describe("stored session runtime", () => {
  test("creates and stores coordinator session state", async () => {
    const store = createMemoryCoordinatorStore();

    const result = await createStoredCoordinatorSession({
      deliveryBaseUrl,
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
    expect(snapshot.state.deliveryBaseUrl).toBe(deliveryBaseUrl);
  });

  test("rejects duplicate coordinator session creation", async () => {
    const store = createMemoryCoordinatorStore();
    await seedCreatedSession(store);

    const result = await createStoredCoordinatorSession({
      deliveryBaseUrl,
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
      state: "ending",
      store,
    });

    expect(result.status).toBe("transitioned");

    if (result.status !== "transitioned") {
      throw new Error("expected session transition");
    }

    const snapshot = await store.load(session.sessionId);
    expect(result.response.status).toBe(200);
    expect(result.state.session.state).toBe("ending");
    expect(result.state.cursor).toBeUndefined();
    expect(snapshot?.state.session.state).toBe("ending");
  });

  test("keeps cursor state aligned with session state", async () => {
    const store = createMemoryCoordinatorStore();
    await seedStore(store, {
      ...createCoordinatorPipeline({
        deliveryBaseUrl,
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

  test("rejects publisher heartbeats clocked before the lease was issued", async () => {
    const store = createMemoryCoordinatorStore();
    await seedCreatedSession(store);

    const first = await heartbeatStoredCoordinatorPublisher({
      now: "2026-01-01T00:00:02.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
      store,
      ttlMs: 3000,
    });
    // A rewound clock is a protocol rejection, not an opaque 500.
    const rewound = await heartbeatStoredCoordinatorPublisher({
      now: "2026-01-01T00:00:01.000Z",
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
      store,
      ttlMs: 3000,
    });

    expect(first.status).toBe("refreshed");
    expect(rewound.status).toBe("rejected");
    expect(rewound.response.status).toBe(409);
    expect(await rewound.response.json()).toEqual({
      error: {
        code: "olos.invalid_state",
        message: "now must be after or equal to publisherLease.issuedAt",
      },
    });
  });

  test("rejects publisher heartbeats for terminal sessions", async () => {
    const store = createMemoryCoordinatorStore();
    await seedStore(
      store,
      createCoordinatorPipeline({
        deliveryBaseUrl,
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
      error: {
        code: "olos.invalid_state",
        message: "Invalid session transition: live -> ended",
      },
    });
  });

  test("rejects invalid stored session transition options", async () => {
    const store = createMemoryCoordinatorStore();

    const invalidSessionId = await transitionStoredCoordinatorSession({
      sessionId: "../session",
      state: "ending",
      store,
    });
    const invalidState = await transitionStoredCoordinatorSession({
      sessionId: session.sessionId,
      state: "paused" as never,
      store,
    });

    expect(invalidSessionId.status).toBe("rejected");
    expect(invalidSessionId.response.status).toBe(400);
    expect(await invalidSessionId.response.json()).toEqual({
      error: {
        code: "olos.invalid_request",
        message: "sessionId must be a non-empty URL-safe identifier",
      },
    });

    expect(invalidState.status).toBe("rejected");
    expect(invalidState.response.status).toBe(400);
    expect(await invalidState.response.json()).toEqual({
      error: {
        code: "olos.invalid_request",
        message: "state must be one of: live, ending, ended, aborted",
      },
    });
  });

  test("rejects invalid stored session transition options before loading state", async () => {
    const store = countingStore();

    const result = await transitionStoredCoordinatorSession({
      sessionId: "../session",
      state: "ending",
      store,
    });

    expect(result.status).toBe("rejected");
    expect(store.loads).toBe(0);
  });

  test("returns not found for missing stored session transitions", async () => {
    const result = await transitionStoredCoordinatorSession({
      sessionId: "missing",
      state: "ending",
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
    expect(invalidPublisher.response.status).toBe(400);
    expect(await invalidPublisher.response.json()).toEqual({
      error: {
        code: "olos.invalid_request",
        message: "publisherInstanceId must be a non-empty URL-safe identifier",
      },
    });

    expect(invalidNow.status).toBe("rejected");
    expect(invalidNow.response.status).toBe(400);
    expect(await invalidNow.response.json()).toEqual({
      error: {
        code: "olos.invalid_request",
        message: "now must be a valid timestamp",
      },
    });

    expect(invalidTtl.status).toBe("rejected");
    expect(invalidTtl.response.status).toBe(400);
    expect(await invalidTtl.response.json()).toEqual({
      error: {
        code: "olos.invalid_request",
        message: "ttlMs must be a positive number",
      },
    });
  });
});

async function seedCreatedSession(
  store: ReturnType<typeof createMemoryCoordinatorStore>
): Promise<void> {
  await seedStore(
    store,
    createCoordinatorPipeline({ deliveryBaseUrl, session })
  );
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
    load: () => {
      loads += 1;
      return Promise.resolve(undefined);
    },
    get loads() {
      return loads;
    },
    save: () => {
      throw new Error("store save should not be called");
    },
  };
}

function cursor(state: Cursor["state"]): Cursor {
  return {
    committedWindow: {
      epoch: session.epoch,
      firstSequenceNumber: 3810,
      lastSequenceNumber: 3810,
      tracks: {
        v1080: {
          init: {
            commitId: "commit_init",
            deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
            objectKey: "media/v1080/init.mp4",
            slotId: "slot_init",
          },
          segments: [
            {
              segment: {
                commitId: "commit_3810",
                deliveryUrl: "https://media.example.com/media/v1080/s3810.m4s",
                objectKey: "media/v1080/s3810.m4s",
                profile: { duration: 2, independent: true },
                slotId: "slot_3810",
              },
              sequenceNumber: 3810,
            },
          ],
          trackId: "v1080",
        },
      },
    },
    deliveryBaseUrl: "https://media.example.com",
    epoch: session.epoch,
    olos: "1.0",
    profile: session.profile,
    sessionId: session.sessionId,
    state,
    updatedAt: "2026-01-01T00:00:02.000Z",
    window: {
      firstSequenceNumber: 3810,
      lastSequenceNumber: 3810,
    },
  };
}
