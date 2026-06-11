import { describe, expect, test } from "bun:test";

import { createCoordinatorPipeline } from "../protocol";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import { issueCoordinatorSlotFromRequest } from "./slot";

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

describe("runtime slot adapter", () => {
  test("issues a slot from a JSON request", async () => {
    const result = await issueCoordinatorSlotFromRequest({
      request: new Request("https://edge.example.com/v1/live/session_1/slots", {
        body: JSON.stringify(slotPayload()),
        method: "POST",
      }),
      state: createCoordinatorPipeline({ pathways, session }),
    });

    expect(result.status).toBe("issued");

    if (result.status !== "issued") {
      throw new Error("expected issued slot");
    }

    expect(result.response.status).toBe(201);
    expect(result.slot.slotId).toBe("slot_3810");
    expect(result.state.slots).toHaveLength(1);
    expect(await result.response.json()).toEqual({ slot: result.slot });
  });

  test("returns invalid responses for malformed JSON requests", async () => {
    const result = await issueCoordinatorSlotFromRequest({
      request: new Request("https://edge.example.com/v1/live/session_1/slots", {
        body: "{",
        method: "POST",
      }),
      state: createCoordinatorPipeline({ pathways, session }),
    });

    expect(result.status).toBe("invalid");
    expect(result.response.status).toBe(400);
  });

  test("returns invalid responses for rejected slot requests", async () => {
    const result = await issueCoordinatorSlotFromRequest({
      request: {
        ...slotPayload(),
        renditionId: "missing",
      },
      state: createCoordinatorPipeline({ pathways, session }),
    });

    expect(result.status).toBe("invalid");
    expect(result.response.status).toBe(400);

    if (result.status !== "invalid") {
      throw new Error("expected invalid slot request");
    }

    expect(result.message).toBe(
      "uploadSlot.renditionId must belong to session.renditions"
    );
  });
});

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
