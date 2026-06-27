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

  test("ignores publisher-supplied objectKey and deliveryUrl in the wire payload", () => {
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

    expect(payload).not.toHaveProperty("objectKey");
    expect(payload).not.toHaveProperty("deliveryUrl");
  });

  test("rejects partNumber on non-part kinds", () => {
    expect(() =>
      parseRuntimeSlotIssuePayload({
        contentType: "video/mp4",
        duration: 2,
        expiresAt: "2026-01-01T00:00:00.000Z",
        kind: "segment",
        maxBytes: 1_000_000,
        mediaSequenceNumber: 3810,
        partNumber: 0,
        renditionId: "v1080",
        slotId: "slot_3810",
      })
    ).toThrow("partNumber is only valid for parts");
  });

  test("requires partNumber when kind is part", () => {
    expect(() =>
      parseRuntimeSlotIssuePayload({
        contentType: "video/mp4",
        duration: 0.5,
        expiresAt: "2026-01-01T00:00:00.000Z",
        kind: "part",
        maxBytes: 25_000,
        mediaSequenceNumber: 3810,
        renditionId: "v1080",
        slotId: "slot_3810_p0",
      })
    ).toThrow('partNumber is required when kind is "part"');
  });

  test("rejects unsafe derivation hints", () => {
    const base = {
      contentType: "video/mp4",
      duration: 2,
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "segment",
      maxBytes: 1_000_000,
      mediaSequenceNumber: 3810,
      renditionId: "v1080",
      slotId: "slot_3810",
    };

    expect(() =>
      parseRuntimeSlotIssuePayload({ ...base, objectKeyPrefix: "../escape" })
    ).toThrow("objectKeyPrefix must be a safe relative path");

    expect(() =>
      parseRuntimeSlotIssuePayload({ ...base, objectKeyNonce: "../slot" })
    ).toThrow("objectKeyNonce must be a non-empty URL-safe identifier");

    expect(() =>
      parseRuntimeSlotIssuePayload({ ...base, extension: "html" })
    ).toThrow("extension must use a supported media extension");
  });
});
