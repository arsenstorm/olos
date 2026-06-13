import { createMemoryCoordinatorStore } from "olos/protocol";
import {
  commitRuntimeUpload,
  createRuntimeObjectLowLatencyProfile,
  createRuntimeSession,
  createStoredCoordinatorRuntimeHandler,
  getRuntimeMasterPlaylist,
  getRuntimeMediaPlaylist,
  getRuntimeSessionHealth,
  getRuntimeSessionRetentionPlan,
  issueRuntimeSlot,
  type RuntimeFetch,
  transitionRuntimeSession,
} from "olos/runtime";
import type { Pathway, Session } from "olos/types";
import { describe, expect, test } from "vitest";

const latency = createRuntimeObjectLowLatencyProfile();

const session = {
  createdAt: "2026-01-01T00:00:00.000Z",
  epoch: 1,
  latencyProfile: latency.latencyProfile,
  olos: "1.0",
  partTarget: latency.partTarget,
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
  segmentTarget: latency.segmentTarget,
  sessionId: "session_1",
  state: "created",
  tenantId: "tenant_1",
} satisfies Session;

const pathways = [
  {
    baseUrl: "https://media.example.com",
    pathwayId: "primary",
    priority: 0,
    providerId: "s3_primary",
    state: "active",
  },
] satisfies Pathway[];

describe("runtime public client flow", () => {
  test("publishes committed objects and reads generated playlists", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      now: () => "2026-01-01T00:00:03.000Z",
      store,
    });
    const fetch = runtimeFetchFor(handle);

    const created = await createRuntimeSession({
      baseUrl: "https://edge.example.com",
      fetch,
      pathways,
      session,
    });

    await transitionRuntimeSession({
      baseUrl: "https://edge.example.com",
      fetch,
      sessionId: session.sessionId,
      state: "starting",
    });
    const live = await transitionRuntimeSession({
      baseUrl: "https://edge.example.com",
      fetch,
      sessionId: session.sessionId,
      state: "live",
    });

    const init = await issueRuntimeSlot({
      baseUrl: "https://edge.example.com",
      fetch,
      payload: {
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
      },
      sessionId: session.sessionId,
    });
    const segment = await issueRuntimeSlot({
      baseUrl: "https://edge.example.com",
      fetch,
      payload: {
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
        duration: latency.segmentTarget,
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "segment",
        maxBytes: 100_000,
        mediaSequenceNumber: 3810,
        objectKey: "media/v1080/3810.m4s",
        publicationMode: "direct-public",
        publisherInstanceId: "publisher_1",
        renditionId: "v1080",
        slotId: "slot_3810",
      },
      sessionId: session.sessionId,
    });

    const initCommit = await commitRuntimeUpload({
      baseUrl: "https://edge.example.com",
      fetch,
      payload: {
        commitId: "commit_init",
        committedAt: "2026-01-01T00:00:01.000Z",
        object: {
          contentType: "video/mp4",
          objectKey: init.slot.objectKey,
          observedAt: "2026-01-01T00:00:01.000Z",
          providerId: "s3_primary",
          size: 1024,
        },
        slotId: init.slot.slotId,
      },
      sessionId: session.sessionId,
    });
    const segmentCommit = await commitRuntimeUpload({
      baseUrl: "https://edge.example.com",
      fetch,
      payload: {
        commitId: "commit_3810",
        committedAt: "2026-01-01T00:00:02.000Z",
        independent: true,
        object: {
          contentType: "video/mp4",
          objectKey: segment.slot.objectKey,
          observedAt: "2026-01-01T00:00:02.000Z",
          providerId: "s3_primary",
          size: 98_304,
        },
        slotId: segment.slot.slotId,
      },
      sessionId: session.sessionId,
    });
    const master = await getRuntimeMasterPlaylist({
      baseUrl: "https://edge.example.com",
      fetch,
      sessionId: session.sessionId,
    });
    const media = await getRuntimeMediaPlaylist({
      baseUrl: "https://edge.example.com",
      fetch,
      renditionId: "v1080",
      sessionId: session.sessionId,
    });
    const health = await getRuntimeSessionHealth({
      baseUrl: "https://edge.example.com",
      fetch,
      sessionId: session.sessionId,
    });
    const retention = await getRuntimeSessionRetentionPlan({
      baseUrl: "https://edge.example.com",
      fetch,
      now: "2026-01-01T00:00:03.000Z",
      sessionId: session.sessionId,
    });

    expect(created.sessionId).toBe(session.sessionId);
    expect(live.state).toBe("live");
    expect(initCommit.commit.slotId).toBe("slot_init");
    expect(segmentCommit.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(master.playlist).toContain("/v1/live/session_1/v1080/media.m3u8");
    expect(media.playlist).toContain("#EXT-X-MEDIA-SEQUENCE:3810");
    expect(media.playlist).toContain(
      '#EXT-X-MAP:URI="https://media.example.com/media/v1080/init.mp4"'
    );
    expect(media.playlist).toContain(
      "https://media.example.com/media/v1080/3810.m4s"
    );
    expect(health.health.status).toBe("active");
    expect(retention.plan.retiredObjects).toEqual([]);
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
