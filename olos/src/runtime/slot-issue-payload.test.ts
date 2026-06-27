import { describe, expect, test } from "bun:test";

import { parseRuntimeSlotIssuePayload } from "./slot-issue-payload";

describe("runtime slot issue payload parser", () => {
  test("parses valid payloads for slot issue requests", () => {
    const payload = parseRuntimeSlotIssuePayload({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/live/session/3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "segment",
      maxBytes: 1_000_000,
      mediaSequenceNumber: 3810,
      minBytes: 1,
      objectKey: "live/session/3810.m4s",
      partNumber: 10,
      renditionId: "v1080",
      slotId: "slot_3810",
    });

    expect(payload).toEqual({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/live/session/3810.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "segment",
      maxBytes: 1_000_000,
      mediaSequenceNumber: 3810,
      minBytes: 1,
      objectKey: "live/session/3810.m4s",
      partNumber: 10,
      renditionId: "v1080",
      slotId: "slot_3810",
    });
  });

  test("parses init slot issue payload object fields", () => {
    const payload = parseRuntimeSlotIssuePayload({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/live/session/init.mp4",
      duration: 1,
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "init",
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      objectKey: "live/session/init.mp4",
      renditionId: "v1080",
      slotId: "slot_init",
    });

    expect(payload).toMatchObject({
      deliveryUrl: "https://media.example.com/live/session/init.mp4",
      kind: "init",
      objectKey: "live/session/init.mp4",
      slotId: "slot_init",
    });
  });

  test("rejects unsafe object keys", () => {
    expect(() =>
      parseRuntimeSlotIssuePayload({
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/live/session/3810.m4s",
        duration: 2,
        expiresAt: "2026-01-01T00:00:00.000Z",
        kind: "segment",
        maxBytes: 1_000_000,
        mediaSequenceNumber: 0,
        objectKey: "media/../secret.m4s",
        renditionId: "v1080",
        slotId: "slot_3810",
      })
    ).toThrow("objectKey must be a safe relative object key");
  });

  test("rejects delivery URLs with query strings", () => {
    expect(() =>
      parseRuntimeSlotIssuePayload({
        contentType: "video/mp4",
        duration: 2,
        deliveryUrl:
          "https://media.example.com/live/session/3810.m4s?token=abc",
        expiresAt: "2026-01-01T00:00:00.000Z",
        kind: "segment",
        maxBytes: 1_000_000,
        mediaSequenceNumber: 0,
        objectKey: "live/session/3810.m4s",
        renditionId: "v1080",
        slotId: "slot_3810",
      })
    ).toThrow("deliveryUrl must not contain query strings or fragments");
  });
});
