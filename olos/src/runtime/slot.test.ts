import { describe, expect, test } from "bun:test";

import { createEmptyCoordinatorState } from "../protocol/coordinator-state.test-helper";
import { issueCoordinatorSlotFromRequest } from "./slot";

describe("runtime slot adapter", () => {
  test("issues a slot from a JSON request", async () => {
    const result = await issueCoordinatorSlotFromRequest({
      request: slotRequest(slotPayload()),
      state: createEmptyCoordinatorState(),
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
      request: slotRequest("{"),
      state: createEmptyCoordinatorState(),
    });

    expect(result.status).toBe("invalid");
    expect(result.response.status).toBe(400);
  });

  test("returns invalid responses for unsafe JSON slot paths", async () => {
    const objectKeyResult = await issueCoordinatorSlotFromRequest({
      request: slotRequest({
        ...slotPayload(),
        objectKey: "media/../secret.m4s",
      }),
      state: createEmptyCoordinatorState(),
    });
    const deliveryUrlResult = await issueCoordinatorSlotFromRequest({
      request: slotRequest({
        ...slotPayload(),
        deliveryUrl: "https://media.example.com/s3810.m4s?token=abc",
      }),
      state: createEmptyCoordinatorState(),
    });

    expect(objectKeyResult.status).toBe("invalid");
    expect(deliveryUrlResult.status).toBe("invalid");

    if (
      objectKeyResult.status !== "invalid" ||
      deliveryUrlResult.status !== "invalid"
    ) {
      throw new Error("expected invalid slot requests");
    }

    expect(objectKeyResult.message).toBe(
      "objectKey must be a safe relative object key"
    );
    expect(deliveryUrlResult.message).toBe(
      "deliveryUrl must not contain query strings or fragments"
    );
  });

  test("returns invalid responses for unsafe JSON slot identifiers", async () => {
    const cases = [
      {
        expected: "publisherInstanceId must be a non-empty URL-safe identifier",
        field: "publisherInstanceId",
      },
      {
        expected: "renditionId must be a non-empty URL-safe identifier",
        field: "renditionId",
      },
      {
        expected: "slotId must be a non-empty URL-safe identifier",
        field: "slotId",
      },
    ] as const;

    for (const testCase of cases) {
      const result = await issueCoordinatorSlotFromRequest({
        request: slotRequest({
          ...slotPayload(),
          [testCase.field]: "../unsafe",
        }),
        state: createEmptyCoordinatorState(),
      });

      expect(result.status).toBe("invalid");

      if (result.status !== "invalid") {
        throw new Error("expected invalid slot request");
      }

      expect(result.message).toBe(testCase.expected);
    }
  });

  test("returns invalid responses for invalid JSON slot numbers", async () => {
    const cases = [
      {
        expected: "duration must be a positive number",
        field: "duration",
        value: 0,
      },
      {
        expected: "maxBytes must be a positive number",
        field: "maxBytes",
        value: 0,
      },
      {
        expected: "mediaSequenceNumber must be a non-negative integer",
        field: "mediaSequenceNumber",
        value: 1.5,
      },
      {
        expected: "minBytes must be a non-negative integer",
        field: "minBytes",
        value: -1,
      },
      {
        expected: "partNumber must be a non-negative integer",
        field: "partNumber",
        value: -1,
      },
    ] as const;

    for (const testCase of cases) {
      const result = await issueCoordinatorSlotFromRequest({
        request: slotRequest({
          ...slotPayload(),
          [testCase.field]: testCase.value,
        }),
        state: createEmptyCoordinatorState(),
      });

      expect(result.status).toBe("invalid");

      if (result.status !== "invalid") {
        throw new Error("expected invalid slot request");
      }

      expect(result.message).toBe(testCase.expected);
    }
  });

  test("returns invalid responses for invalid JSON publication modes", async () => {
    const result = await issueCoordinatorSlotFromRequest({
      request: slotRequest({
        ...slotPayload(),
        publicationMode: "unknown",
      }),
      state: createEmptyCoordinatorState(),
    });

    expect(result.status).toBe("invalid");

    if (result.status !== "invalid") {
      throw new Error("expected invalid slot request");
    }

    expect(result.message).toBe(
      "publicationMode must be one of: direct-public, read-gated, private-upload-public-promotion"
    );
  });

  test("returns invalid responses for invalid JSON media object kinds", async () => {
    const result = await issueCoordinatorSlotFromRequest({
      request: slotRequest({
        ...slotPayload(),
        kind: "playlist",
      }),
      state: createEmptyCoordinatorState(),
    });

    expect(result.status).toBe("invalid");

    if (result.status !== "invalid") {
      throw new Error("expected invalid slot request");
    }

    expect(result.message).toBe(
      "kind must be one of: init, part, segment, sidecar"
    );
  });

  test("returns invalid responses for rejected slot requests", async () => {
    const result = await issueCoordinatorSlotFromRequest({
      request: {
        ...slotPayload(),
        renditionId: "missing",
      },
      state: createEmptyCoordinatorState(),
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

function slotRequest(body: string | unknown): Request {
  return new Request("https://edge.example.com/v1/live/session_1/slots", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    method: "POST",
  });
}
