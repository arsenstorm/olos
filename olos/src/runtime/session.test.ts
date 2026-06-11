import { describe, expect, test } from "bun:test";

import {
  createCoordinatorPipeline,
  createMemoryCoordinatorStore,
} from "../protocol";
import type { CoordinatorPipelineState } from "../protocol/coordinator";
import type { Cursor } from "../types/cursor";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import {
  createStoredCoordinatorSession,
  transitionStoredCoordinatorSession,
} from "./session";

const session: Session = {
  createdAt: "2026-01-01T00:00:00.000Z",
  epoch: 1,
  latencyProfile: "object-ll",
  olos: "1.0",
  partTarget: 0.5,
  renditions: [
    {
      bitrate: 5_000_000,
      codec: "avc1.640028",
      frameRate: 30,
      height: 1080,
      kind: "video",
      renditionId: "v1080",
      width: 1920,
    },
  ],
  segmentTarget: 2,
  sessionId: "session_1",
  state: "created",
  tenantId: "tenant_1",
};

const pathways: Pathway[] = [
  {
    baseUrl: "https://media.example.com",
    pathwayId: "primary",
    priority: 0,
    providerId: "s3_primary",
    state: "active",
  },
];

describe("stored session runtime", () => {
  test("creates and stores coordinator session state", async () => {
    const store = createMemoryCoordinatorStore();

    const result = await createStoredCoordinatorSession({
      pathways,
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
    expect(snapshot.state.pathways).toEqual(pathways);
  });

  test("rejects duplicate coordinator session creation", async () => {
    const store = createMemoryCoordinatorStore();
    await seedStore(store, createCoordinatorPipeline({ pathways, session }));

    const result = await createStoredCoordinatorSession({
      pathways,
      session,
      store,
    });

    expect(result.status).toBe("conflict");
    expect(result.response.status).toBe(409);
  });

  test("transitions stored coordinator sessions", async () => {
    const store = createMemoryCoordinatorStore();
    await seedStore(store, createCoordinatorPipeline({ pathways, session }));

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
    expect(snapshot?.state.session.state).toBe("starting");
  });

  test("keeps cursor state aligned with session state", async () => {
    const store = createMemoryCoordinatorStore();
    await seedStore(store, {
      ...createCoordinatorPipeline({
        pathways,
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

  test("rejects invalid stored session transitions", async () => {
    const store = createMemoryCoordinatorStore();
    await seedStore(store, createCoordinatorPipeline({ pathways, session }));

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

  test("returns not found for missing stored session transitions", async () => {
    const result = await transitionStoredCoordinatorSession({
      sessionId: "missing",
      state: "starting",
      store: createMemoryCoordinatorStore(),
    });

    expect(result.status).toBe("not_found");
    expect(result.response.status).toBe(404);
  });
});

async function seedStore(
  store: ReturnType<typeof createMemoryCoordinatorStore>,
  state: CoordinatorPipelineState
): Promise<void> {
  const saved = await store.save({
    sessionId: state.session.sessionId,
    state,
  });

  if (saved.status !== "saved") {
    throw new Error("expected seeded coordinator state");
  }
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
    partTarget: session.partTarget,
    pathways,
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
