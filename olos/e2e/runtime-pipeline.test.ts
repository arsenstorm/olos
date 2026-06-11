import { createMemoryCoordinatorStore } from "olos/protocol";
import {
  commitStoredCoordinatorUploadFromRequest,
  createStoredCoordinatorSession,
  issueStoredCoordinatorSlotFromRequest,
  planStoredCoordinatorRetention,
  serveStoredCoordinatorManifest,
  transitionStoredCoordinatorSession,
} from "olos/runtime";
import type { Pathway, Session } from "olos/types";
import { assertCursor } from "olos/validation";
import { describe, expect, test } from "vitest";

const session = {
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

describe("runtime pipeline", () => {
  test("runs stored coordinator lifecycle through public runtime exports", async () => {
    const store = createMemoryCoordinatorStore();

    const created = await createStoredCoordinatorSession({
      pathways,
      session,
      store,
    });

    expect(created.status).toBe("created");

    const initIssue = await issueStoredCoordinatorSlotFromRequest({
      request: slotPayload({
        deliveryUrl: "https://media.example.com/media/v1080/init.mp4",
        duration: 1,
        kind: "init",
        maxBytes: 2048,
        mediaSequenceNumber: 0,
        objectKey: "media/v1080/init.mp4",
        slotId: "slot_init",
      }),
      sessionId: session.sessionId,
      store,
    });
    const segmentIssue = await issueStoredCoordinatorSlotFromRequest({
      request: slotPayload({
        deliveryUrl: "https://media.example.com/media/v1080/3810.m4s",
        duration: 2,
        kind: "segment",
        maxBytes: 100_000,
        mediaSequenceNumber: 3810,
        objectKey: "media/v1080/3810.m4s",
        slotId: "slot_3810",
      }),
      sessionId: session.sessionId,
      store,
    });
    const nextIssue = await issueStoredCoordinatorSlotFromRequest({
      request: slotPayload({
        deliveryUrl: "https://media.example.com/media/v1080/3811.m4s",
        duration: 2,
        kind: "segment",
        maxBytes: 100_000,
        mediaSequenceNumber: 3811,
        objectKey: "media/v1080/3811.m4s",
        slotId: "slot_3811",
      }),
      sessionId: session.sessionId,
      store,
    });

    expect(initIssue.status).toBe("issued");
    expect(segmentIssue.status).toBe("issued");
    expect(nextIssue.status).toBe("issued");

    const initCommit = await commitStoredCoordinatorUploadFromRequest({
      request: commitPayload({
        commitId: "commit_init",
        objectKey: "media/v1080/init.mp4",
        size: 1024,
        slotId: "slot_init",
      }),
      sessionId: session.sessionId,
      store,
    });
    const segmentCommit = await commitStoredCoordinatorUploadFromRequest({
      request: {
        ...commitPayload({
          commitId: "commit_3810",
          objectKey: "media/v1080/3810.m4s",
          size: 98_304,
          slotId: "slot_3810",
        }),
        independent: true,
      },
      sessionId: session.sessionId,
      store,
    });

    expect(initCommit.status).toBe("committed");
    expect(segmentCommit.status).toBe("committed");

    const snapshot = await store.load(session.sessionId);
    const cursor = snapshot?.state.cursor;

    if (snapshot === undefined || cursor === undefined) {
      throw new Error("expected stored cursor");
    }

    assertCursor(cursor);

    const master = await serveStoredCoordinatorManifest({
      allowedMediaOrigins: ["https://media.example.com"],
      partTarget: session.partTarget,
      request: "https://edge.example.com/v1/live/session_1/master.m3u8",
      segmentTarget: session.segmentTarget,
      sessionId: session.sessionId,
      store,
      targetLatency: 3,
    });
    const media = await serveStoredCoordinatorManifest({
      allowedMediaOrigins: ["https://media.example.com"],
      partTarget: session.partTarget,
      request: "https://edge.example.com/v1/live/session_1/v1080/media.m3u8",
      segmentTarget: session.segmentTarget,
      sessionId: session.sessionId,
      store,
      targetLatency: 3,
    });

    expect(cursor.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(master.status).toBe(200);
    expect(await master.text()).toContain(
      "/v1/live/session_1/v1080/media.m3u8"
    );
    expect(media.status).toBe(200);
    expect(await media.text()).toContain(
      "https://media.example.com/media/v1080/3810.m4s"
    );

    const transitioned = await transitionStoredCoordinatorSession({
      sessionId: session.sessionId,
      state: "ending",
      store,
    });

    expect(transitioned.status).toBe("transitioned");

    if (transitioned.status !== "transitioned") {
      throw new Error("expected session transition");
    }

    expect(transitioned.state.session.state).toBe("ending");
    expect(transitioned.state.cursor?.state).toBe("ending");

    const retention = await planStoredCoordinatorRetention({
      now: "2026-01-01T00:00:06.000Z",
      sessionId: session.sessionId,
      store,
    });

    expect(retention.status).toBe("planned");

    if (retention.status !== "planned") {
      throw new Error("expected retention plan");
    }

    expect(retention.plan.expiredSlots.map((slot) => slot.slotId)).toEqual([
      "slot_3811",
    ]);
    expect(retention.plan.retiredObjects).toEqual([]);
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
    publicationMode: "direct-public" as const,
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
