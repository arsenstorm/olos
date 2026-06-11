import { describe, expect, test } from "bun:test";

import { createMemoryCoordinatorStore } from "../protocol";
import { createPublicationKillSwitch } from "../state";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
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

describe("stored coordinator runtime handler", () => {
  test("runs stored coordinator routes through Request and Response", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      now: () => "2026-01-01T00:00:06.000Z",
      store,
    });

    const created = await handle(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
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

  test("returns route errors for unsupported requests", async () => {
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
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
  });

  test("applies publication control to slot issuance", async () => {
    const store = createMemoryCoordinatorStore();
    const setup = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      store,
    });
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedMediaOrigins: ["https://media.example.com"],
      publicationControl: createPublicationKillSwitch("incident"),
      store,
    });

    await setup(
      jsonRequest("https://edge.example.com/sessions", {
        pathways,
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

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { message: "publication operation is disabled" },
    });
    expect(stored?.state.slots).toEqual([]);
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

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}
