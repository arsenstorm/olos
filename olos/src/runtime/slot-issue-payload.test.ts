import { describe, expect, test } from "bun:test";

import { parseRuntimeSlotIssuePayload } from "./slot-issue-payload";

describe("runtime slot issue payload parser", () => {
  test("parses intent payloads for slot issue requests", () => {
    const payload = parseRuntimeSlotIssuePayload({
      contentType: "video/mp4",
      duration: 2,
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "segment",
      maxBytes: 1_000_000,
      mediaSequenceNumber: 3810,
      minBytes: 1,
      partNumber: 10,
      renditionId: "v1080",
      slotId: "slot_3810",
    });

    expect(payload).toEqual({
      contentType: "video/mp4",
      duration: 2,
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "segment",
      maxBytes: 1_000_000,
      mediaSequenceNumber: 3810,
      minBytes: 1,
      partNumber: 10,
      renditionId: "v1080",
      slotId: "slot_3810",
    });
  });

  test("parses init slot intent fields", () => {
    const payload = parseRuntimeSlotIssuePayload({
      contentType: "video/mp4",
      duration: 1,
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "init",
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      renditionId: "v1080",
      slotId: "slot_init",
    });

    expect(payload).toMatchObject({
      kind: "init",
      slotId: "slot_init",
    });
  });

  test("threads optional derivation hints", () => {
    const payload = parseRuntimeSlotIssuePayload({
      contentType: "video/mp4",
      duration: 2,
      expiresAt: "2026-01-01T00:00:00.000Z",
      extension: "m4s",
      kind: "segment",
      maxBytes: 1_000_000,
      mediaSequenceNumber: 3810,
      objectKeyNonce: "slot_01JZ",
      objectKeyPrefix: "live/session",
      renditionId: "v1080",
      slotId: "slot_3810",
    });

    expect(payload).toMatchObject({
      extension: "m4s",
      objectKeyNonce: "slot_01JZ",
      objectKeyPrefix: "live/session",
    });
  });

  test("accepts publisher-supplied objectKey and deliveryUrl as compat hints", () => {
    const payload = parseRuntimeSlotIssuePayload({
      contentType: "video/mp4",
      deliveryUrl: "https://media.example.com/anything.m4s",
      duration: 2,
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "segment",
      maxBytes: 1_000_000,
      mediaSequenceNumber: 3810,
      objectKey: "any/key.m4s",
      renditionId: "v1080",
      slotId: "slot_3810",
    });

    expect(payload.objectKey).toBe("any/key.m4s");
    expect(payload.deliveryUrl).toBe("https://media.example.com/anything.m4s");
  });

  test("rejects unsafe objectKey", () => {
    expect(() =>
      parseRuntimeSlotIssuePayload({
        contentType: "video/mp4",
        duration: 2,
        expiresAt: "2026-01-01T00:00:00.000Z",
        kind: "segment",
        maxBytes: 1_000_000,
        mediaSequenceNumber: 3810,
        objectKey: "media/../secret.m4s",
        renditionId: "v1080",
        slotId: "slot_3810",
      })
    ).toThrow("objectKey must be a safe relative object key");
  });
});
