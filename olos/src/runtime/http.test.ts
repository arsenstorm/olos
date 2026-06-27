import { describe, expect, test } from "bun:test";

import { createMemoryCoordinatorStore } from "../protocol";
import {
  TEST_COORDINATOR_MEDIA_BASE_URL as mediaBaseUrl,
  testCoordinatorSession as session,
} from "../protocol/coordinator-state.test-helper";
import { createPublicationKillSwitch } from "../state";
import type { Cursor } from "../types/cursor";
import { createMemoryRuntimeCursorNotifier } from "./cursor-notifier";
import { createStoredCoordinatorRuntimeHandler } from "./http";
import {
  jsonPostRequest,
  jsonResponseStatusAndBody,
} from "./test-http.test-helper";

const MEDIA_ORIGIN = "https://media.example.com";

describe("stored coordinator runtime handler", () => {
  test("rejects invalid runtime handler options", () => {
    const options = {
      allowedMediaOrigins: [MEDIA_ORIGIN],
      store: createMemoryCoordinatorStore(),
    };

    expect(() =>
      createStoredCoordinatorRuntimeHandler({
        ...options,
        allowedMediaOrigins: ["http://media.example.com"],
      })
    ).toThrow("allowedMediaOrigins must contain HTTPS origins");
    expect(() =>
      createStoredCoordinatorRuntimeHandler({
        ...options,
        allowedMediaOrigins: ["https://media.example.com/path"],
      })
    ).toThrow("allowedMediaOrigins must contain HTTPS origins");
    expect(() =>
      createStoredCoordinatorRuntimeHandler({ ...options, livePath: "live" })
    ).toThrow("livePath must be a safe route path");
    expect(() =>
      createStoredCoordinatorRuntimeHandler({
        ...options,
        livePath: "/../live",
      })
    ).toThrow("livePath must be a safe route path");
    expect(() =>
      createStoredCoordinatorRuntimeHandler({
        ...options,
        sessionPath: "/sessions?debug=1",
      })
    ).toThrow("sessionPath must not contain query strings or fragments");
    expect(() =>
      createStoredCoordinatorRuntimeHandler({ ...options, maxAttempts: 0 })
    ).toThrow("maxAttempts must be a positive integer");
    expect(() =>
      createStoredCoordinatorRuntimeHandler({ ...options, maxAttempts: 1.5 })
    ).toThrow("maxAttempts must be a positive integer");
    expect(() =>
      createStoredCoordinatorRuntimeHandler({ ...options, targetLatency: 0 })
    ).toThrow("targetLatency must be a positive number");
    expect(() =>
      createStoredCoordinatorRuntimeHandler({
        ...options,
        lateToleranceMs: -1,
      })
    ).toThrow("lateToleranceMs must be a non-negative number");
    expect(() =>
      createStoredCoordinatorRuntimeHandler({
        ...options,
        maxHealthCursorAgeMs: 0,
      })
    ).toThrow("maxHealthCursorAgeMs must be a positive number");
    expect(() =>
      createStoredCoordinatorRuntimeHandler({
        ...options,
        publisherLeaseTtlMs: 0,
      })
    ).toThrow("publisherLeaseTtlMs must be a positive number");
    expect(() =>
      createStoredCoordinatorRuntimeHandler({
        ...options,
        blockingReload: {
          timeoutMs: -1,
          waitForCursor: () => Promise.resolve(undefined),
        },
      })
    ).toThrow("blockingReload.timeoutMs must be a non-negative number");
  });

  test("runs stored coordinator routes through Request and Response", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      now: () => "2026-01-01T00:00:06.000Z",
      store,
    });

    const created = await handle(
      jsonRequest("https://edge.example.com/sessions", {
        mediaBaseUrl,
        session,
      })
    );

    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ sessionId: session.sessionId });

    const initSlot = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
          duration: 1,
          kind: "init",
          maxBytes: 2048,
          mediaSequenceNumber: 0,
          objectKey: "media/v1080/init.mp4",
          slotId: "slot_init",
        })
      )
    );
    const segmentSlot = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "media/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );
    const nextSlot = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/3811.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3811,
          objectKey: "media/v1080/3811.m4s",
          slotId: "slot_3811",
        })
      )
    );

    expect(initSlot.status).toBe(201);
    expect(segmentSlot.status).toBe(201);
    expect(nextSlot.status).toBe(201);

    const initCommit = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/commits",
        commitPayload({
          commitId: "commit_init",
          objectKey: "media/v1080/init.mp4",
          size: 1024,
          slotId: "slot_init",
        })
      )
    );
    const segmentCommit = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/commits", {
        ...commitPayload({
          commitId: "commit_3810",
          objectKey: "media/v1080/3810.m4s",
          size: 98_304,
          slotId: "slot_3810",
        }),
        independent: true,
      })
    );

    expect(initCommit.status).toBe(201);
    expect(segmentCommit.status).toBe(201);

    const master = await handle(
      new Request("https://edge.example.com/v1/live/session_1/master.m3u8")
    );
    const media = await handle(
      new Request("https://edge.example.com/v1/live/session_1/v1080/media.m3u8")
    );

    expect(master.status).toBe(200);
    expect(await master.text()).toContain(
      "/v1/live/session_1/v1080/media.m3u8"
    );
    expect(media.status).toBe(200);
    expect(await media.text()).toContain(
      "https://media.example.com/media/v1080/3810.m4s"
    );

    const transitioned = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/transition", {
        state: "ending",
      })
    );
    const retention = await handle(
      new Request("https://edge.example.com/sessions/session_1/retention")
    );

    expect(transitioned.status).toBe(200);
    expect(await transitioned.json()).toEqual({
      sessionId: session.sessionId,
      state: "ending",
    });
    expect(retention.status).toBe(200);
    expect(await retention.json()).toMatchObject({
      plan: {
        expiredSlots: [{ slotId: "slot_3811" }],
        retiredObjects: [],
      },
    });
  });

  test("commits late uploads within configured route tolerance", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      store,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        mediaBaseUrl,
        session,
      })
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
          duration: 1,
          kind: "init",
          maxBytes: 2048,
          mediaSequenceNumber: 0,
          objectKey: "media/v1080/init.mp4",
          slotId: "slot_init",
        })
      )
    );
    await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/commits", {
        ...commitPayload({
          commitId: "commit_init",
          objectKey: "media/v1080/init.mp4",
          size: 1024,
          slotId: "slot_init",
        }),
      })
    );
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "media/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );

    const payload = commitPayload({
      commitId: "commit_3810",
      objectKey: "media/v1080/3810.m4s",
      size: 98_304,
      slotId: "slot_3810",
    });
    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/commits", {
        ...payload,
        committedAt: "2026-01-01T00:00:05.500Z",
        independent: true,
        lateToleranceMs: 1000,
        object: {
          ...payload.object,
          observedAt: "2026-01-01T00:00:05.500Z",
        },
      })
    );
    const stored = await store.load(session.sessionId);

    expect(response.status).toBe(201);
    expect(stored?.state.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
  });

  test("returns route errors for unsupported requests", async () => {
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      store: createMemoryCoordinatorStore(),
    });

    expect(
      await handle(new Request("https://edge.example.com/unknown"))
    ).toHaveProperty("status", 404);
    expect(
      await handle(
        new Request("https://edge.example.com/sessions/session_1/slots")
      )
    ).toHaveProperty("status", 405);
    expect(
      await handle(
        jsonRequest("https://edge.example.com/sessions/session_1/unknown", {})
      )
    ).toHaveProperty("status", 405);
    expect(
      await handle(
        new Request(
          "https://edge.example.com/v1/live/session_1/v1080/extra.m3u8"
        )
      )
    ).toHaveProperty("status", 404);
  });

  test("returns specific errors for missing runtime sessions", async () => {
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      store: createMemoryCoordinatorStore(),
    });

    const health = await handle(
      new Request("https://edge.example.com/sessions/missing_session/health")
    );
    const manifest = await handle(
      new Request(
        "https://edge.example.com/v1/live/missing_session/master.m3u8"
      )
    );

    await expect(jsonResponseStatusAndBody(health)).resolves.toEqual({
      body: { error: { message: "coordinator session was not found" } },
      status: 404,
    });
    await expect(jsonResponseStatusAndBody(manifest)).resolves.toEqual({
      body: { error: { message: "coordinator session was not found" } },
      status: 404,
    });
  });

  test("rejects unsafe route session identifiers", async () => {
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      store: createMemoryCoordinatorStore(),
    });

    const health = await handle(
      new Request("https://edge.example.com/sessions/bad%20id/health")
    );
    const manifest = await handle(
      new Request("https://edge.example.com/v1/live/bad%20id/master.m3u8")
    );

    await expect(jsonResponseStatusAndBody(health)).resolves.toEqual({
      body: {
        error: {
          message: "sessionId must be a non-empty URL-safe identifier",
        },
      },
      status: 400,
    });
    await expect(jsonResponseStatusAndBody(manifest)).resolves.toEqual({
      body: {
        error: {
          message: "sessionId must be a non-empty URL-safe identifier",
        },
      },
      status: 400,
    });
  });

  test("rejects malformed route percent encoding", async () => {
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      store: createMemoryCoordinatorStore(),
    });

    const response = await handle(
      new Request("https://edge.example.com/sessions/%E0%A4%A/health")
    );

    await expect(jsonResponseStatusAndBody(response)).resolves.toEqual({
      body: {
        error: { message: "route path contains invalid percent encoding" },
      },
      status: 400,
    });
  });

  test("returns invalid responses for invalid session creation payloads", async () => {
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      store: createMemoryCoordinatorStore(),
    });

    const sessionResponse = await handle(
      jsonRequest("https://edge.example.com/sessions", {
        mediaBaseUrl,
        session: { ...session, state: "paused" },
      })
    );

    await expect(jsonResponseStatusAndBody(sessionResponse)).resolves.toEqual({
      body: {
        error: {
          message:
            "session.state must be one of: created, starting, live, ending, ended, aborted, expired",
        },
      },
      status: 400,
    });
  });

  test("returns invalid responses for invalid session transition states", async () => {
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      store: createMemoryCoordinatorStore(),
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        mediaBaseUrl,
        session,
      })
    );

    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/transition", {
        state: "unknown",
      })
    );

    await expect(jsonResponseStatusAndBody(response)).resolves.toEqual({
      body: {
        error: {
          message:
            "state must be one of: created, starting, live, ending, ended, aborted, expired",
        },
      },
      status: 400,
    });
  });

  test("applies publication control to slot issuance", async () => {
    const store = createMemoryCoordinatorStore();
    const setup = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      store,
    });
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      publicationControl: createPublicationKillSwitch("incident"),
      store,
    });

    await setup(
      jsonRequest("https://edge.example.com/sessions", {
        mediaBaseUrl,
        session,
      })
    );

    const response = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3810,
          objectKey: "media/v1080/3810.m4s",
          slotId: "slot_3810",
        })
      )
    );
    const stored = await store.load(session.sessionId);

    await expect(jsonResponseStatusAndBody(response)).resolves.toEqual({
      body: {
        error: {
          code: "olos.security_policy_violation",
          details: {
            operation: "issue_slot",
            reason: "incident",
          },
          message: "publication operation is disabled",
        },
      },
      status: 409,
    });
    expect(stored?.state.slots).toEqual([]);
  });

  test("stores publisher heartbeats through the session route", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      now: () => "2026-01-01T00:00:02.000Z",
      publisherLeaseTtlMs: 3000,
      store,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        mediaBaseUrl,
        session,
      })
    );

    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/heartbeat", {
        publisherInstanceId: "pub_1",
      })
    );
    const health = await handle(
      new Request("https://edge.example.com/sessions/session_1/health")
    );
    const stored = await store.load(session.sessionId);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      lease: {
        expiresAt: "2026-01-01T00:00:05.000Z",
        issuedAt: "2026-01-01T00:00:02.000Z",
        lastSeenAt: "2026-01-01T00:00:02.000Z",
        publisherInstanceId: "pub_1",
        sessionId: session.sessionId,
        tenantId: session.tenantId,
      },
    });
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      health: {
        cursorFreshness: "missing",
        leaseStatus: "active",
        publisherInstanceId: "pub_1",
        status: "starting",
      },
    });
    expect(stored?.state.publisherLeases).toHaveLength(1);
  });

  test("uses injected clock when now callback is omitted", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      clock: () => "2026-01-01T00:00:03.000Z",
      publisherLeaseTtlMs: 3000,
      store,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        mediaBaseUrl,
        session,
      })
    );

    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/heartbeat", {
        publisherInstanceId: "pub_1",
      })
    );

    expect(await response.json()).toEqual({
      lease: {
        expiresAt: "2026-01-01T00:00:06.000Z",
        issuedAt: "2026-01-01T00:00:03.000Z",
        lastSeenAt: "2026-01-01T00:00:03.000Z",
        publisherInstanceId: "pub_1",
        sessionId: session.sessionId,
        tenantId: session.tenantId,
      },
    });
  });

  test("uses the object low-latency cursor staleness default for health", async () => {
    const store = createMemoryCoordinatorStore();
    await seedRuntimeStore(store, 3810);

    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      now: () => "2026-01-01T00:00:06.500Z",
      store,
    });

    const response = await handle(
      new Request("https://edge.example.com/sessions/session_1/health")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      health: {
        cursorAgeMs: 4500,
        cursorFreshness: "fresh",
        status: "active",
      },
    });
  });

  test("filters health by publisher instance query", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      now: () => "2026-01-01T00:00:02.000Z",
      publisherLeaseTtlMs: 3000,
      store,
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        mediaBaseUrl,
        session,
      })
    );
    await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/heartbeat", {
        publisherInstanceId: "pub_1",
      })
    );
    await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/heartbeat", {
        publisherInstanceId: "pub_2",
      })
    );

    const response = await handle(
      new Request(
        "https://edge.example.com/sessions/session_1/health?publisherInstanceId=pub_2"
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      health: {
        leaseStatus: "active",
        publisherInstanceId: "pub_2",
      },
    });
  });

  test("rejects invalid heartbeat publisher identifiers", async () => {
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      store: createMemoryCoordinatorStore(),
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        mediaBaseUrl,
        session,
      })
    );

    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/heartbeat", {
        publisherInstanceId: "../pub",
      })
    );

    await expect(jsonResponseStatusAndBody(response)).resolves.toEqual({
      body: {
        error: {
          message:
            "publisherInstanceId must be a non-empty URL-safe identifier",
        },
      },
      status: 400,
    });
  });

  test("rejects invalid heartbeat payload shapes", async () => {
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      store: createMemoryCoordinatorStore(),
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        mediaBaseUrl,
        session,
      })
    );

    const response = await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/heartbeat",
        "not an object"
      )
    );

    await expect(jsonResponseStatusAndBody(response)).resolves.toEqual({
      body: {
        error: {
          message: "publisher heartbeat request must be a JSON object",
        },
      },
      status: 400,
    });
  });

  test("rejects invalid health publisher query identifiers", async () => {
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      store: createMemoryCoordinatorStore(),
    });

    await handle(
      jsonRequest("https://edge.example.com/sessions", {
        mediaBaseUrl,
        session,
      })
    );

    const response = await handle(
      new Request(
        "https://edge.example.com/sessions/session_1/health?publisherInstanceId=../pub"
      )
    );

    await expect(jsonResponseStatusAndBody(response)).resolves.toEqual({
      body: {
        error: {
          message:
            "publisherInstanceId must be a non-empty URL-safe identifier",
        },
      },
      status: 400,
    });
  });

  test("waits for blocking media playlist reloads", async () => {
    const store = createMemoryCoordinatorStore();
    const advancedStore = createMemoryCoordinatorStore();

    await seedRuntimeStore(store, 3810);
    const advancedCursor = await seedRuntimeStore(advancedStore, 3811);
    let waits = 0;

    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      blockingReload: {
        timeoutMs: 100,
        waitForCursor: () => {
          waits += 1;
          return Promise.resolve(advancedCursor);
        },
      },
      store,
    });

    const response = await handle(
      new Request(
        "https://edge.example.com/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3811"
      )
    );

    expect(response.status).toBe(200);
    expect(waits).toBe(1);
    expect(await response.text()).toContain(
      "https://media.example.com/media/v1080/3811.m4s"
    );
  });

  test("wakes blocking media playlist reloads after commit routes advance the cursor", async () => {
    const store = createMemoryCoordinatorStore();
    const notifier = createMemoryRuntimeCursorNotifier();
    let waits = 0;
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      blockingReload: {
        timeoutMs: 1000,
        waitForCursor: (context) => {
          waits += 1;
          return notifier.waitForCursor(context);
        },
      },
      cursorNotifier: notifier,
      store,
    });

    await seedRuntimeStore(store, 3810);
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/3811.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3811,
          objectKey: "media/v1080/3811.m4s",
          slotId: "slot_3811",
        })
      )
    );

    const pending = handle(
      new Request(
        "https://edge.example.com/v1/live/session_1/v1080/media.m3u8?_HLS_msn=3811"
      )
    );

    await waitFor(() => waits === 1);

    const committed = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/commits", {
        ...commitPayload({
          commitId: "commit_3811",
          objectKey: "media/v1080/3811.m4s",
          size: 98_304,
          slotId: "slot_3811",
        }),
        independent: false,
      })
    );
    const response = await pending;

    expect(committed.status).toBe(201);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      "https://media.example.com/media/v1080/3811.m4s"
    );
  });

  test("does not notify cursor waiters for rejected commit routes", async () => {
    const notifiedCursors: Cursor[] = [];
    const store = createMemoryCoordinatorStore();

    await seedRuntimeStore(store, 3810);

    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: [MEDIA_ORIGIN],
      commitPolicy: () => ({
        error: {
          error: {
            code: "olos.quota_exceeded",
            message: "tenant quota exceeded",
          },
        },
        status: "rejected",
      }),
      cursorNotifier: {
        notify: (cursor) => notifiedCursors.push(cursor),
        waitForCursor: () =>
          Promise.reject(new Error("waiter should not be called")),
      },
      store,
    });

    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/slots",
        slotPayload({
          deliveryUrl: "https://media.example.com/media/v1080/3811.m4s",
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3811,
          objectKey: "media/v1080/3811.m4s",
          slotId: "slot_3811",
        })
      )
    );

    const response = await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/commits", {
        ...commitPayload({
          commitId: "commit_3811",
          objectKey: "media/v1080/3811.m4s",
          size: 98_304,
          slotId: "slot_3811",
        }),
        independent: false,
      })
    );
    const stored = await store.load(session.sessionId);

    await expect(jsonResponseStatusAndBody(response)).resolves.toEqual({
      body: {
        error: {
          code: "olos.quota_exceeded",
          message: "tenant quota exceeded",
        },
      },
      status: 409,
    });
    expect(stored?.state.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(notifiedCursors).toEqual([]);
  });
});

interface SlotPayloadOptions {
  deliveryUrl: string;
  duration: number;
  kind: "init" | "segment";
  maxBytes: number;
  mediaSequenceNumber: number;
  objectKey: string;
  slotId: string;
}

function slotPayload(options: SlotPayloadOptions) {
  return {
    contentType: "video/mp4",
    deliveryUrl: options.deliveryUrl,
    duration: options.duration,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: options.kind,
    maxBytes: options.maxBytes,
    mediaSequenceNumber: options.mediaSequenceNumber,
    objectKey: options.objectKey,
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
    slotId: options.slotId,
  };
}

interface CommitPayloadOptions {
  commitId: string;
  objectKey: string;
  size: number;
  slotId: string;
}

function commitPayload(options: CommitPayloadOptions) {
  return {
    commitId: options.commitId,
    committedAt: "2026-01-01T00:00:02.000Z",
    object: {
      contentType: "video/mp4",
      objectKey: options.objectKey,
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: options.size,
    },
    slotId: options.slotId,
  };
}

function jsonRequest(url: string, body: unknown): Request {
  return jsonPostRequest(url, body);
}

async function seedRuntimeStore(
  store: ReturnType<typeof createMemoryCoordinatorStore>,
  through: 3810 | 3811
): Promise<Cursor> {
  const handle = createStoredCoordinatorRuntimeHandler({
    allowedMediaOrigins: [MEDIA_ORIGIN],
    store,
  });

  await handle(
    jsonRequest("https://edge.example.com/sessions", {
      mediaBaseUrl,
      session,
    })
  );

  const slots: SlotPayloadOptions[] = [
    {
      deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
      duration: 1,
      kind: "init",
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      objectKey: "media/v1080/init.mp4",
      slotId: "slot_init",
    },
    {
      deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
      duration: 2,
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKey: "media/v1080/3810.m4s",
      slotId: "slot_3810",
    },
    {
      deliveryUrl: "https://media.example.com/media/v1080/3811.m4s",
      duration: 2,
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3811,
      objectKey: "media/v1080/3811.m4s",
      slotId: "slot_3811",
    },
  ];
  const commits: Array<CommitPayloadOptions & { independent: boolean }> = [
    {
      commitId: "commit_init",
      independent: false,
      objectKey: "media/v1080/init.mp4",
      size: 1024,
      slotId: "slot_init",
    },
    {
      commitId: "commit_3810",
      independent: true,
      objectKey: "media/v1080/3810.m4s",
      size: 98_304,
      slotId: "slot_3810",
    },
    {
      commitId: "commit_3811",
      independent: false,
      objectKey: "media/v1080/3811.m4s",
      size: 98_304,
      slotId: "slot_3811",
    },
  ];
  const seedCount = through === 3810 ? 2 : 3;

  for (const slot of slots.slice(0, seedCount)) {
    await handle(
      jsonRequest(
        "https://edge.example.com/sessions/session_1/slots",
        slotPayload(slot)
      )
    );
  }

  for (const commit of commits.slice(0, seedCount)) {
    await handle(
      jsonRequest("https://edge.example.com/sessions/session_1/commits", {
        ...commitPayload(commit),
        independent: commit.independent,
      })
    );
  }

  const snapshot = await store.load(session.sessionId);

  if (snapshot?.state.cursor === undefined) {
    throw new Error("expected seeded cursor");
  }

  return snapshot.state.cursor;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("condition was not met");
}
