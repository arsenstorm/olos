import { describe, expect, test } from "bun:test";
import { createMemoryCoordinatorStore } from "../protocol";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import {
  commitRuntimeUpload,
  createRuntimeSession,
  getRuntimeMasterPlaylist,
  getRuntimeMediaPlaylist,
  getRuntimeSessionHealth,
  getRuntimeSessionRetentionPlan,
  issueRuntimeSlot,
  type RuntimeFetch,
  RuntimeHttpError,
  sendRuntimePublisherHeartbeat,
  transitionRuntimeSession,
} from "./client";
import { createStoredCoordinatorRuntimeHandler } from "./http";

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
  state: "live",
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

describe("runtime HTTP client", () => {
  test("creates sessions, issues slots, commits uploads, and transitions state", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      store,
    });
    const clientFetch = runtimeFetchFor(handle);

    const created = await createRuntimeSession({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      pathways,
      session: { ...session, state: "created" },
    });
    const transitioned = await transitionRuntimeSession({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      sessionId: session.sessionId,
      state: "starting",
    });
    const live = await transitionRuntimeSession({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      sessionId: session.sessionId,
      state: "live",
    });
    const issued = await issueRuntimeSlot({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      payload: {
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/init.mp4",
        duration: 1,
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "init",
        maxBytes: 2048,
        mediaSequenceNumber: 0,
        objectKey: "media/init-slot_1.mp4",
        publicationMode: "direct-public",
        publisherInstanceId: "publisher_1",
        renditionId: "v1080",
        slotId: "slot_init",
      },
      sessionId: session.sessionId,
    });
    const committed = await commitRuntimeUpload({
      baseUrl: "https://edge.example.com",
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
    });

    expect(created.response.status).toBe(201);
    expect(created.sessionId).toBe(session.sessionId);
    expect(transitioned).toMatchObject({
      sessionId: session.sessionId,
      state: "starting",
    });
    expect(live.state).toBe("live");
    expect(issued.response.status).toBe(201);
    expect(issued.slot.slotId).toBe("slot_init");
    expect(committed.response.status).toBe(201);
    expect(committed.commit.slotId).toBe("slot_init");
  });

  test("sends publisher heartbeats and reads stored health", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      now: () => "2026-01-01T00:00:02.000Z",
      store,
    });
    const clientFetch = runtimeFetchFor(handle);

    await handle(
      new Request("https://edge.example.com/sessions", {
        body: JSON.stringify({ pathways, session }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );

    const heartbeat = await sendRuntimePublisherHeartbeat({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
    });
    const health = await getRuntimeSessionHealth({
      baseUrl: "https://edge.example.com",
      fetch: clientFetch,
      publisherInstanceId: "publisher_1",
      sessionId: session.sessionId,
    });
    const retention = await getRuntimeSessionRetentionPlan({
      baseUrl: "https://edge.example.com",
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
      publisherInstanceId: "publisher_1",
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
      baseUrl: "https://edge.example.com",
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
      renditionId: "v1080",
      sessionId: session.sessionId,
    });

    expect(media.playlist).toBe("#EXTM3U\n");
    expect(requestedUrl).toBe(
      "https://edge.example.com/runtime/live/session_1/v1080/media.m3u8?_HLS_msn=3810&_HLS_part=3"
    );
  });

  test("throws for failed runtime responses", async () => {
    const clientFetch: RuntimeFetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: "missing" } }), {
          headers: { "content-type": "application/json" },
          status: 404,
        })
      );

    const heartbeatError = sendRuntimePublisherHeartbeat({
      baseUrl: "https://edge.example.com",
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
        baseUrl: "https://edge.example.com",
        fetch: clientFetch,
        pathways,
        session,
      })
    ).rejects.toThrow("session create failed with status 404");

    await expect(
      transitionRuntimeSession({
        baseUrl: "https://edge.example.com",
        fetch: clientFetch,
        sessionId: session.sessionId,
        state: "ended",
      })
    ).rejects.toThrow("session transition failed with status 404");

    await expect(
      issueRuntimeSlot({
        baseUrl: "https://edge.example.com",
        fetch: clientFetch,
        payload: {
          contentType: "video/mp4",
          deliveryUrl: "https://media.example.com/init.mp4",
          duration: 1,
          expiresAt: "2026-01-01T00:00:05.000Z",
          kind: "init",
          maxBytes: 2048,
          mediaSequenceNumber: 0,
          objectKey: "media/init-slot_1.mp4",
          publicationMode: "direct-public",
          publisherInstanceId: "publisher_1",
          renditionId: "v1080",
          slotId: "slot_init",
        },
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("slot issue failed with status 404");

    await expect(
      commitRuntimeUpload({
        baseUrl: "https://edge.example.com",
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
        baseUrl: "https://edge.example.com",
        fetch: clientFetch,
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("session health failed with status 404");

    await expect(
      getRuntimeSessionRetentionPlan({
        baseUrl: "https://edge.example.com",
        fetch: clientFetch,
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("session retention failed with status 404");

    await expect(
      getRuntimeMasterPlaylist({
        baseUrl: "https://edge.example.com",
        fetch: clientFetch,
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("master playlist failed with status 404");

    await expect(
      getRuntimeMediaPlaylist({
        baseUrl: "https://edge.example.com",
        fetch: clientFetch,
        renditionId: "v1080",
        sessionId: session.sessionId,
      })
    ).rejects.toThrow("media playlist failed with status 404");
  });
});

function runtimeFetchFor(
  handle: (request: Request) => Promise<Response>
): RuntimeFetch {
  return (request, init) =>
    handle(
      request instanceof Request ? request : new Request(String(request), init)
    );
}
