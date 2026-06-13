import { describe, expect, test } from "bun:test";

import {
  commitCoordinatorUpload,
  createCoordinatorPipeline,
  issueCoordinatorSlot,
} from "../protocol";
import type { CoordinatorPipelineState } from "../protocol/coordinator";
import { createObservedUpload } from "../state/observed-upload";
import type { Pathway } from "../types/pathway";
import type { Session } from "../types/session";
import { commitCoordinatorUploadFromRequest } from "./commit";

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

describe("runtime commit adapter", () => {
  test("commits an upload from a JSON request", async () => {
    const result = await commitCoordinatorUploadFromRequest({
      request: new Request(
        "https://edge.example.com/v1/live/session_1/commit",
        {
          body: JSON.stringify(commitPayload()),
          method: "POST",
        }
      ),
      state: createReadyState(),
    });

    expect(result.status).toBe("committed");

    if (result.status !== "committed") {
      throw new Error("expected committed upload");
    }

    expect(result.response.status).toBe(201);
    expect(result.state.commits).toHaveLength(1);
    expect(result.state.cursor?.window).toEqual({
      firstMediaSequenceNumber: 3810,
      lastMediaSequenceNumber: 3810,
    });
    expect(await result.response.json()).toMatchObject({
      commit: { commitId: "commit_3810" },
    });
  });

  test("returns invalid responses for malformed JSON requests", async () => {
    const result = await commitCoordinatorUploadFromRequest({
      request: new Request(
        "https://edge.example.com/v1/live/session_1/commit",
        {
          body: "{",
          method: "POST",
        }
      ),
      state: createReadyState(),
    });

    expect(result.status).toBe("invalid");
    expect(result.response.status).toBe(400);
  });

  test("returns invalid responses for unsafe JSON object keys", async () => {
    const result = await commitCoordinatorUploadFromRequest({
      request: new Request(
        "https://edge.example.com/v1/live/session_1/commit",
        {
          body: JSON.stringify({
            ...commitPayload(),
            object: {
              ...commitPayload().object,
              objectKey: "media/../secret.m4s",
            },
          }),
          method: "POST",
        }
      ),
      state: createReadyState(),
    });

    expect(result.status).toBe("invalid");

    if (result.status !== "invalid") {
      throw new Error("expected invalid commit request");
    }

    expect(result.response.status).toBe(400);
    expect(result.message).toBe(
      "object.objectKey must be a safe relative object key"
    );
  });

  test("returns invalid responses for non-positive object sizes", async () => {
    const result = await commitCoordinatorUploadFromRequest({
      request: new Request(
        "https://edge.example.com/v1/live/session_1/commit",
        {
          body: JSON.stringify({
            ...commitPayload(),
            object: {
              ...commitPayload().object,
              size: 0,
            },
          }),
          method: "POST",
        }
      ),
      state: createReadyState(),
    });

    expect(result.status).toBe("invalid");

    if (result.status !== "invalid") {
      throw new Error("expected invalid commit request");
    }

    expect(result.response.status).toBe(400);
    expect(result.message).toBe("size must be a positive number");
  });

  test("returns protocol rejection responses", async () => {
    const result = await commitCoordinatorUploadFromRequest({
      request: {
        ...commitPayload(),
        slotId: "missing",
      },
      state: createReadyState(),
    });

    expect(result.status).toBe("rejected");

    if (result.status !== "rejected") {
      throw new Error("expected rejected upload");
    }

    expect(result.error.error.code).toBe("olos.unknown_slot");
    expect(result.response.status).toBe(404);
  });
});

function createReadyState(): CoordinatorPipelineState {
  const state = createCoordinatorPipeline({ pathways, session });
  const init = issueCoordinatorSlot({
    contentType: "video/mp4",
    deliveryUrl: "https://media.example.com/init.mp4",
    duration: 1,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: "init",
    maxBytes: 2048,
    mediaSequenceNumber: 0,
    objectKey: "media/init.mp4",
    publicationMode: "direct-public",
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
    slotId: "slot_init",
    state,
  });
  const committedInit = commitCoordinatorUpload({
    commitId: "commit_init",
    committedAt: "2026-01-01T00:00:02.000Z",
    object: createObservedUpload({
      contentType: "video/mp4",
      objectKey: "media/init.mp4",
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: 1024,
    }),
    slotId: "slot_init",
    state: init.state,
  });

  if (committedInit.status !== "committed") {
    throw new Error("expected committed init");
  }

  return issueCoordinatorSlot({
    contentType: "video/mp4",
    deliveryUrl: "https://media.example.com/s3810.m4s",
    duration: 2,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: "segment",
    maxBytes: 100_000,
    mediaSequenceNumber: 3810,
    objectKey: "media/s3810.m4s",
    publicationMode: "direct-public",
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
    slotId: "slot_3810",
    state: committedInit.state,
  }).state;
}

function commitPayload() {
  return {
    commitId: "commit_3810",
    committedAt: "2026-01-01T00:00:02.000Z",
    independent: true,
    object: {
      contentType: "video/mp4",
      objectKey: "media/s3810.m4s",
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: 98_304,
    },
    slotId: "slot_3810",
  };
}
