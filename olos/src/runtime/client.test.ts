import { describe, expect, test } from "bun:test";
import { createMemoryCoordinatorStore } from "../protocol/coordinator-memory-store";
import {
  TEST_COORDINATOR_DELIVERY_BASE_URL as deliveryBaseUrl,
  testCoordinatorSession as session,
} from "../protocol/coordinator-state.test-helper";
import {
  commitRuntimeUpload,
  createRuntimeSession,
  getRuntimeMasterPlaylist,
  getRuntimeMediaPlaylist,
  getRuntimeSessionHealth,
  getRuntimeSessionRetentionPlan,
  issueRuntimeSlot,
  sendRuntimePublisherHeartbeat,
  transitionRuntimeSession,
} from "./client";
import { type RuntimeFetch, RuntimeHttpError } from "./client-types";
import { createStoredCoordinatorRuntimeHandler } from "./http";
import { runtimeFetchFor } from "./test-fetch.test-helper";
import {
  jsonErrorTestResponse,
  jsonPostRequest,
} from "./test-http.test-helper";

const MEDIA_ORIGIN = "https://media.example.com";
const RUNTIME_BASE_URL = "https://edge.example.com";

describe("runtime HTTP client", () => {
  test("creates sessions, issues slots, commits uploads, and transitions state", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedDeliveryOrigins: [MEDIA_ORIGIN],
      store,
    });
    const clientFetch = runtimeFetchFor(handle);

    const created = await createRuntimeSession({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      deliveryBaseUrl,
      session: { ...session, state: "live" },
    });
    const issued = await issueRuntimeSlot({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      payload: {
        contentType: "video/mp4",
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "init",
        maxBytes: 2048,
        sequenceNumber: 0,
        objectKeyNonce: "slot_1",
        trackId: "v1080",
        slotId: "slot_init",
      },
      sessionId: session.sessionId,
    });
    const committed = await commitRuntimeUpload({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      payload: {
        commitId: "commit_init",
        committedAt: "2026-01-01T00:00:02.000Z",
        object: {
          contentType: "video/mp4",
          objectKey: issued.slot.objectKey,
          observedAt: "2026-01-01T00:00:02.000Z",
          providerId: "s3_primary",
          size: 1024,
        },
        slotId: "slot_init",
      },
      sessionId: session.sessionId,
    });

    expect(created.response.status).toBe(201);
    expect(created.sessionId).toBe(session.sessionId);
    expect(issued.response.status).toBe(201);
    expect(issued.slot.slotId).toBe("slot_init");
    expect(committed.response.status).toBe(201);
    expect(committed.commit.slotId).toBe("slot_init");
  });

  test("ignores unknown fields in slot, commit, and cursor responses", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedDeliveryOrigins: [MEDIA_ORIGIN],
      store,
    });
    const handlerFetch = runtimeFetchFor(handle);
    // Spec §11.2: consumers must ignore unknown fields. Simulate a newer
    // coordinator by injecting extras into every payload the client parses.
    const clientFetch: RuntimeFetch = async (input, init) => {
      const response = await handlerFetch(input, init);
      const body = await response.json();

      return new Response(JSON.stringify(withUnknownResponseFields(body)), {
        headers: { "content-type": "application/json" },
        status: response.status,
      });
    };

    await createRuntimeSession({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      deliveryBaseUrl,
      session: { ...session, state: "live" },
    });
    const issuedInit = await issueRuntimeSlot({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      payload: {
        contentType: "video/mp4",
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "init",
        maxBytes: 2048,
        sequenceNumber: 0,
        objectKeyNonce: "slot_1",
        trackId: "v1080",
        slotId: "slot_init",
      },
      sessionId: session.sessionId,
    });
    await commitRuntimeUpload({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      payload: {
        commitId: "commit_init",
        committedAt: "2026-01-01T00:00:02.000Z",
        object: {
          contentType: "video/mp4",
          objectKey: issuedInit.slot.objectKey,
          observedAt: "2026-01-01T00:00:02.000Z",
          providerId: "s3_primary",
          size: 1024,
        },
        slotId: "slot_init",
      },
      sessionId: session.sessionId,
    });
    const issuedSegment = await issueRuntimeSlot({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      payload: {
        contentType: "video/mp4",
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "segment",
        maxBytes: 200_000,
        sequenceNumber: 0,
        objectKeyNonce: "slot_2",
        trackId: "v1080",
        slotId: "slot_seg",
      },
      sessionId: session.sessionId,
    });
    const committed = await commitRuntimeUpload({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      payload: {
        commitId: "commit_seg",
        committedAt: "2026-01-01T00:00:03.000Z",
        object: {
          contentType: "video/mp4",
          objectKey: issuedSegment.slot.objectKey,
          observedAt: "2026-01-01T00:00:03.000Z",
          providerId: "s3_primary",
          size: 4096,
        },
        slotId: "slot_seg",
      },
      sessionId: session.sessionId,
    });

    expect(issuedSegment.slot.slotId).toBe("slot_seg");
    expect("extra" in issuedSegment.slot).toBe(false);
    expect(committed.commit.slotId).toBe("slot_seg");
    expect("extra" in committed.commit).toBe(false);

    if (committed.cursor === undefined) {
      throw new Error("expected a cursor after the segment commit");
    }

    expect("extra" in committed.cursor).toBe(false);
  });

  test("sends publisher heartbeats and reads stored health", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedDeliveryOrigins: [MEDIA_ORIGIN],
      now: () => "2026-01-01T00:00:02.000Z",
      store,
    });
    const clientFetch = runtimeFetchFor(handle);

    await handle(
      jsonPostRequest("https://edge.example.com/sessions", {
        deliveryBaseUrl,
        session,
      })
    );

    const heartbeat = await sendRuntimePublisherHeartbeat({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
    });
    const health = await getRuntimeSessionHealth({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      sessionId: session.sessionId,
    });
    const retention = await getRuntimeSessionRetentionPlan({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      now: "2026-01-01T00:00:02.000Z",
      sessionId: session.sessionId,
    });

    expect(heartbeat.response.status).toBe(200);
    expect(heartbeat.lease.publisherInstanceId).toBe("publisher_1");
    expect(health.response.status).toBe(200);
    expect(health.health).toEqual({
      cursorFreshness: "missing",
      leaseStatus: "active",
      status: "starting",
    });
    expect(retention.response.status).toBe(200);
    expect(retention.plan.retiredObjects).toEqual([]);
  });

  test("fetches generated master playlists", async () => {
    let requestedUrl = "";
    const clientFetch: RuntimeFetch = (request) => {
      requestedUrl = String(request);
      return Promise.resolve(
        new Response("#EXTM3U\n/v1/live/session_1/v1080/media.m3u8\n", {
          status: 200,
        })
      );
    };

    const master = await getRuntimeMasterPlaylist({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      sessionId: session.sessionId,
    });

    expect(master.response.status).toBe(200);
    expect(master.playlist).toContain("#EXTM3U");
    expect(master.playlist).toContain("/v1/live/session_1/v1080/media.m3u8");
    expect(requestedUrl).toBe(
      "https://edge.example.com/v1/live/session_1/master.m3u8"
    );
  });

  test("fetches media playlists with blocking reload query parameters", async () => {
    let requestedUrl = "";
    const clientFetch: RuntimeFetch = (request) => {
      requestedUrl = String(request);
      return Promise.resolve(new Response("#EXTM3U\n", { status: 200 }));
    };

    const media = await getRuntimeMediaPlaylist({
      baseUrl: "https://edge.example.com/runtime",
      fetch: clientFetch,
      hlsMsn: 3810,
      hlsPart: 3,
      livePath: "/live",
      trackId: "v1080",
      sessionId: session.sessionId,
    });

    expect(media.playlist).toBe("#EXTM3U\n");
    expect(requestedUrl).toBe(
      "https://edge.example.com/runtime/live/session_1/v1080/media.m3u8?_HLS_msn=3810&_HLS_part=3"
    );
  });

  test("rejects invalid blocking reload query parameters before fetch", async () => {
    let requests = 0;
    const clientFetch: RuntimeFetch = () => {
      requests += 1;
      return Promise.resolve(new Response("#EXTM3U\n", { status: 200 }));
    };
    const options = {
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      trackId: "v1080",
      sessionId: session.sessionId,
    };

    await expect(
      getRuntimeMediaPlaylist({ ...options, hlsMsn: -1 })
    ).rejects.toThrow("hlsMsn must be a non-negative integer");
    await expect(
      getRuntimeMediaPlaylist({ ...options, hlsPart: Number.NaN })
    ).rejects.toThrow("hlsPart must be a non-negative integer");
    expect(requests).toBe(0);
  });

  test("rejects unsafe live playlist paths before fetch", async () => {
    let requests = 0;
    const clientFetch: RuntimeFetch = () => {
      requests += 1;
      return Promise.resolve(new Response("#EXTM3U\n", { status: 200 }));
    };
    const options = {
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      sessionId: session.sessionId,
    };

    await expect(
      getRuntimeMasterPlaylist({ ...options, livePath: "https://evil.test" })
    ).rejects.toThrow("livePath must be a safe relative path");
    await expect(
      getRuntimeMediaPlaylist({
        ...options,
        livePath: "../live",
        trackId: "v1080",
      })
    ).rejects.toThrow("livePath must be a safe relative path");
    expect(requests).toBe(0);
  });

  test("throws for failed runtime responses", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(jsonErrorTestResponse("missing", 404));

    const heartbeatError = sendRuntimePublisherHeartbeat({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
    }).catch((error: unknown) => error);

    await expect(heartbeatError).resolves.toBeInstanceOf(RuntimeHttpError);
    await expect(heartbeatError).resolves.toMatchObject({
      body: { error: { message: "missing" } },
      message: "publisher heartbeat failed with status 404",
      status: 404,
    });
    await expect(heartbeatError).resolves.toHaveProperty(
      "response.status",
      404
    );

    await expect(
      createRuntimeSession({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        deliveryBaseUrl,
        session,
      })
    ).rejects.toThrow("session create failed with status 404");

    await expect(
      transitionRuntimeSession({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        sessionId: session.sessionId,
        state: "ended",
      })
    ).rejects.toThrow("session transition failed with status 404");

    await expect(
      issueRuntimeSlot({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          contentType: "video/mp4",
          expiresAt: "2026-01-01T00:00:05.000Z",
          kind: "init",
          maxBytes: 2048,
          sequenceNumber: 0,
          trackId: "v1080",
          slotId: "slot_init",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("slot issue failed with status 404");

    await expect(
      commitRuntimeUpload({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          commitId: "commit_init",
          committedAt: "2026-01-01T00:00:02.000Z",
          object: {
            contentType: "video/mp4",
            objectKey: "media/init-slot_1.mp4",
            observedAt: "2026-01-01T00:00:02.000Z",
            providerId: "s3_primary",
            size: 1024,
          },
          slotId: "slot_init",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("upload commit failed with status 404");

    await expect(
      getRuntimeSessionHealth({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("session health failed with status 404");

    await expect(
      getRuntimeSessionRetentionPlan({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("session retention failed with status 404");

    await expect(
      getRuntimeMasterPlaylist({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("master playlist failed with status 404");

    await expect(
      getRuntimeMediaPlaylist({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        trackId: "v1080",
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("media playlist failed with status 404");
  });

  test("captures text bodies for failed runtime responses", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response("plain failure", {
          status: 503,
        })
      );

    const error = getRuntimeMasterPlaylist({
      baseUrl: RUNTIME_BASE_URL,
      fetch: clientFetch,
      sessionId: session.sessionId,
    }).catch((caught: unknown) => caught);

    await expect(error).resolves.toBeInstanceOf(RuntimeHttpError);
    await expect(error).resolves.toMatchObject({
      body: "plain failure",
      message: "master playlist failed with status 503",
      status: 503,
    });
  });

  test("validates slot issue response payloads", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            slot: {
              slotId: "slot_init",
            },
          }),
          { status: 201 }
        )
      );

    await expect(
      issueRuntimeSlot({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          contentType: "video/mp4",
          expiresAt: "2026-01-01T00:00:05.000Z",
          kind: "init",
          maxBytes: 2048,
          sequenceNumber: 0,
          trackId: "v1080",
          slotId: "slot_init",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("uploadSlot");
  });

  test("validates commit response payloads", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            commit: {
              status: "committed",
            },
          }),
          { status: 201 }
        )
      );

    await expect(
      commitRuntimeUpload({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        payload: {
          commitId: "commit_init",
          committedAt: "2026-01-01T00:00:02.000Z",
          object: {
            contentType: "video/mp4",
            objectKey: "media/init-slot_1.mp4",
            observedAt: "2026-01-01T00:00:02.000Z",
            providerId: "s3_primary",
            size: 1024,
          },
          slotId: "slot_init",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("commit.commitId");
  });

  test("validates session health response payloads", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            health: {
              cursorFreshness: "missing",
              status: "bad",
            },
          }),
          { status: 200 }
        )
      );

    await expect(
      getRuntimeSessionHealth({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("session health response health.status");
  });

  test("validates optional session health response payload fields", async () => {
    const invalidLeaseStatusFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            health: {
              cursorFreshness: "fresh",
              leaseStatus: "missing",
              status: "active",
            },
          }),
          { status: 200 }
        )
      );
    const invalidCursorAgeFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            health: {
              cursorAgeMs: Number.POSITIVE_INFINITY,
              cursorFreshness: "stale",
              status: "stale",
            },
          }),
          { status: 200 }
        )
      );

    await expect(
      getRuntimeSessionHealth({
        baseUrl: RUNTIME_BASE_URL,
        fetch: invalidLeaseStatusFetch,
        sessionId: session.sessionId,
      })
    ).rejects.toThrow(
      "session health response health.leaseStatus must be active or stale"
    );
    await expect(
      getRuntimeSessionHealth({
        baseUrl: RUNTIME_BASE_URL,
        fetch: invalidCursorAgeFetch,
        sessionId: session.sessionId,
      })
    ).rejects.toThrow(
      "session health response health.cursorAgeMs must be a finite number"
    );
  });

  test("validates transition response payload state", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            sessionId: session.sessionId,
            state: "bad",
          }),
          { status: 200 }
        )
      );

    await expect(
      transitionRuntimeSession({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        sessionId: session.sessionId,
        state: "live",
      })
    ).rejects.toThrow("session transition response state must be one of:");
  });

  test("validates session retention response payloads", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            plan: {
              expiredSlots: [
                {
                  slotId: "slot_init",
                },
              ],
              retiredObjects: [],
            },
          }),
          { status: 200 }
        )
      );

    await expect(
      getRuntimeSessionRetentionPlan({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("uploadSlot");
  });

  test("validates session retention retired object response payloads", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            plan: {
              expiredSlots: [],
              retiredObjects: [
                {
                  commitId: "commit_init",
                  slotId: "slot_init",
                },
              ],
            },
          }),
          { status: 200 }
        )
      );

    await expect(
      getRuntimeSessionRetentionPlan({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        sessionId: session.sessionId,
      })
    ).rejects.toThrow(
      "runtime session retention plan retiredObjects[0].objectKey must be set"
    );
  });

  test("validates session retention cursor response payloads", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            plan: {
              cursor: "cursor_1",
              expiredSlots: [],
              retiredObjects: [],
            },
          }),
          { status: 200 }
        )
      );

    await expect(
      getRuntimeSessionRetentionPlan({
        baseUrl: RUNTIME_BASE_URL,
        fetch: clientFetch,
        sessionId: session.sessionId,
      })
    ).rejects.toThrow(
      "runtime session retention plan cursor must be an object"
    );
  });
});

function withUnknownResponseFields(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return body;
  }

  const record = body as Record<string, unknown>;
  const noisy: Record<string, unknown> = { ...record, extra: 1 };

  for (const field of ["commit", "cursor", "slot"] as const) {
    const value = record[field];

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      noisy[field] = { ...value, extra: 1 };
    }
  }

  return noisy;
}
