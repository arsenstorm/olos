import { describe, expect, test } from "bun:test";

import { createMemoryCoordinatorStore } from "../protocol/coordinator-memory-store";
import {
  TEST_COORDINATOR_DELIVERY_BASE_URL as deliveryBaseUrl,
  testCoordinatorSession as session,
} from "../protocol/coordinator-state.test-helper";
import { createStoredCoordinatorRuntimeHandler } from "./http";
import { jsonPostRequest } from "./test-http.test-helper";

const MEDIA_ORIGIN = "https://media.example.com";

describe("live route with a custom livePath", () => {
  test("serves master and media playlists under the configured livePath, not the default", async () => {
    const store = createMemoryCoordinatorStore();
    const handle = createStoredCoordinatorRuntimeHandler({
      allowedDeliveryOrigins: [MEDIA_ORIGIN],
      livePath: "/live",
      publicationMode: "read-gated",
      store,
    });

    await handle(
      jsonPostRequest("https://edge.example.com/sessions", {
        deliveryBaseUrl,
        session,
      })
    );

    await handle(
      jsonPostRequest(
        "https://edge.example.com/sessions/session_1/slots",
        slotPayload({
          duration: 1,
          kind: "init",
          maxBytes: 2048,
          objectKey: "objects/v1080/init",
          sequenceNumber: 0,
          slotId: "slot_init",
        })
      )
    );
    await handle(
      jsonPostRequest(
        "https://edge.example.com/sessions/session_1/slots",
        slotPayload({
          duration: 2,
          kind: "segment",
          maxBytes: 100_000,
          objectKey: "objects/v1080/s3810",
          sequenceNumber: 3810,
          slotId: "slot_3810",
        })
      )
    );

    await handle(
      jsonPostRequest("https://edge.example.com/sessions/session_1/commits", {
        ...commitPayload({
          commitId: "commit_init",
          objectKey: "objects/v1080/init",
          size: 1024,
          slotId: "slot_init",
        }),
      })
    );
    await handle(
      jsonPostRequest("https://edge.example.com/sessions/session_1/commits", {
        ...commitPayload({
          commitId: "commit_3810",
          objectKey: "objects/v1080/s3810",
          size: 98_304,
          slotId: "slot_3810",
        }),
        profile: { independent: true },
      })
    );

    const master = await handle(
      new Request("https://edge.example.com/live/session_1/master.m3u8")
    );
    const media = await handle(
      new Request("https://edge.example.com/live/session_1/v1080/media.m3u8")
    );

    expect(master.status).toBe(200);
    expect(await master.text()).toContain("/live/session_1/v1080/media.m3u8");
    expect(media.status).toBe(200);
    expect(await media.text()).toContain(
      "https://media.example.com/objects/v1080/s3810"
    );

    const defaultMaster = await handle(
      new Request("https://edge.example.com/v1/live/session_1/master.m3u8")
    );
    const defaultMedia = await handle(
      new Request("https://edge.example.com/v1/live/session_1/v1080/media.m3u8")
    );

    expect(defaultMaster.status).toBe(404);
    expect(defaultMedia.status).toBe(404);
  });
});

interface SlotPayloadOptions {
  duration: number;
  kind: "init" | "segment";
  maxBytes: number;
  objectKey: string;
  sequenceNumber: number;
  slotId: string;
}

function slotPayload(options: SlotPayloadOptions) {
  return {
    contentType: "video/mp4",
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: options.kind,
    maxBytes: options.maxBytes,
    profile: { duration: options.duration },
    sequenceNumber: options.sequenceNumber,
    slotId: options.slotId,
    trackId: "v1080",
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
