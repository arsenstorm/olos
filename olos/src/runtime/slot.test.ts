import { describe, expect, test } from "bun:test";

import { createEmptyCoordinatorState } from "../protocol/coordinator-state.test-helper";
import { issueCoordinatorSlotFromRequest } from "./slot";
import { rawOrJsonPostRequest } from "./test-http.test-helper";
import {
  assertInvalidResult,
  invalidResultMessage,
} from "./test-result.test-helper";

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

  test("issues a slot from a direct payload object", async () => {
    const result = await issueCoordinatorSlotFromRequest({
      request: slotPayload(),
      state: createEmptyCoordinatorState(),
    });

    expect(result.status).toBe("issued");

    if (result.status !== "issued") {
      throw new Error("expected issued slot");
    }

    expect(result.slot.slotId).toBe("slot_3810");
    expect(result.state.slots).toHaveLength(1);
  });

  test("returns invalid responses for malformed JSON requests", async () => {
    const result = await issueCoordinatorSlotFromRequest({
      request: slotRequest("{"),
      state: createEmptyCoordinatorState(),
    });

    assertInvalidResult(result);
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

    expect(invalidResultMessage(objectKeyResult)).toBe(
      "objectKey must be a safe relative object key"
    );
    expect(invalidResultMessage(deliveryUrlResult)).toBe(
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

      expect(invalidResultMessage(result)).toBe(testCase.expected);
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

      expect(invalidResultMessage(result)).toBe(testCase.expected);
    }
  });

  test("returns invalid responses for invalid JSON media object kinds", async () => {
    const result = await issueCoordinatorSlotFromRequest({
      request: slotRequest({
        ...slotPayload(),
        kind: "playlist",
      }),
      state: createEmptyCoordinatorState(),
    });

    expect(invalidResultMessage(result)).toBe(
      "kind must be one of: init, part, segment"
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

    expect(invalidResultMessage(result)).toBe(
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
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
    slotId: "slot_3810",
  };
}

function slotRequest(body: string | unknown): Request {
  return rawOrJsonPostRequest(
    "https://edge.example.com/v1/live/session_1/slots",
    body
  );
}
