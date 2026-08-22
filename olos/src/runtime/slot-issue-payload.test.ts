import { describe, expect, test } from "bun:test";

import { parseRuntimeSlotIssuePayload } from "./slot-issue-payload";

describe("runtime slot issue payload parser", () => {
  test("parses intent payloads for slot issue requests", () => {
    const payload = parseRuntimeSlotIssuePayload({
      contentType: "video/mp4",
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "segment",
      maxBytes: 1_000_000,
      sequenceNumber: 3810,
      minBytes: 1,
      profile: { duration: 2 },
      trackId: "v1080",
      slotId: "slot_3810",
    });

    expect(payload).toEqual({
      contentType: "video/mp4",
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "segment",
      maxBytes: 1_000_000,
      sequenceNumber: 3810,
      minBytes: 1,
      profile: { duration: 2 },
      trackId: "v1080",
      slotId: "slot_3810",
    });
  });

  test("omits profile when the payload carries none", () => {
    const payload = parseRuntimeSlotIssuePayload({
      contentType: "application/octet-stream",
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "segment",
      maxBytes: 1_000_000,
      sequenceNumber: 3810,
      trackId: "v1080",
      slotId: "slot_3810",
    });

    expect(payload.profile).toBeUndefined();
  });

  test("rejects a profile that is not an object", () => {
    for (const profile of [null, "x", 1, []]) {
      expect(() =>
        parseRuntimeSlotIssuePayload({
          contentType: "video/mp4",
          expiresAt: "2026-01-01T00:00:00.000Z",
          kind: "segment",
          maxBytes: 1_000_000,
          profile,
          sequenceNumber: 3810,
          trackId: "v1080",
          slotId: "slot_3810",
        })
      ).toThrow("profile must be an object");
    }
  });

  test("parses init slot intent fields", () => {
    const payload = parseRuntimeSlotIssuePayload({
      contentType: "video/mp4",
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "init",
      maxBytes: 2048,
      sequenceNumber: 0,
      trackId: "v1080",
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
      expiresAt: "2026-01-01T00:00:00.000Z",
      extension: "m4s",
      kind: "segment",
      maxBytes: 1_000_000,
      sequenceNumber: 3810,
      objectKeyNonce: "slot_01JZ",
      objectKeyPrefix: "live/session",
      trackId: "v1080",
      slotId: "slot_3810",
    });

    expect(payload).toMatchObject({
      extension: "m4s",
      objectKeyNonce: "slot_01JZ",
      objectKeyPrefix: "live/session",
    });
  });

  test("rejects publisher-supplied objectKey in the wire payload", () => {
    expect(() =>
      parseRuntimeSlotIssuePayload({
        contentType: "video/mp4",
        expiresAt: "2026-01-01T00:00:00.000Z",
        kind: "segment",
        maxBytes: 1_000_000,
        sequenceNumber: 3810,
        objectKey: "any/key.m4s",
        trackId: "v1080",
        slotId: "slot_3810",
      })
    ).toThrow(
      "slot issue payload must not include objectKey (the coordinator derives it)"
    );
  });

  test("rejects publisher-supplied deliveryUrl in the wire payload", () => {
    expect(() =>
      parseRuntimeSlotIssuePayload({
        contentType: "video/mp4",
        deliveryUrl: "https://media.example.com/anything.m4s",
        expiresAt: "2026-01-01T00:00:00.000Z",
        kind: "segment",
        maxBytes: 1_000_000,
        sequenceNumber: 3810,
        trackId: "v1080",
        slotId: "slot_3810",
      })
    ).toThrow(
      "slot issue payload must not include deliveryUrl (the coordinator derives it)"
    );
  });

  test("rejects partNumber on non-part kinds", () => {
    expect(() =>
      parseRuntimeSlotIssuePayload({
        contentType: "video/mp4",
        expiresAt: "2026-01-01T00:00:00.000Z",
        kind: "segment",
        maxBytes: 1_000_000,
        sequenceNumber: 3810,
        partNumber: 0,
        trackId: "v1080",
        slotId: "slot_3810",
      })
    ).toThrow("partNumber is only valid for parts");
  });

  test("requires partNumber when kind is part", () => {
    expect(() =>
      parseRuntimeSlotIssuePayload({
        contentType: "video/mp4",
        expiresAt: "2026-01-01T00:00:00.000Z",
        kind: "part",
        maxBytes: 25_000,
        sequenceNumber: 3810,
        trackId: "v1080",
        slotId: "slot_3810_p0",
      })
    ).toThrow('partNumber is required when kind is "part"');
  });

  test("rejects unsafe derivation hints", () => {
    const base = {
      contentType: "video/mp4",
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "segment",
      maxBytes: 1_000_000,
      sequenceNumber: 3810,
      trackId: "v1080",
      slotId: "slot_3810",
    };

    expect(() =>
      parseRuntimeSlotIssuePayload({ ...base, objectKeyPrefix: "../escape" })
    ).toThrow("objectKeyPrefix must be a safe relative path");

    expect(() =>
      parseRuntimeSlotIssuePayload({ ...base, objectKeyNonce: "../slot" })
    ).toThrow("objectKeyNonce must be a non-empty URL-safe identifier");

    expect(() =>
      parseRuntimeSlotIssuePayload({ ...base, extension: "../m4s" })
    ).toThrow("extension must be a safe path segment without dots");
  });

  test("accepts any safe extension without media validation", () => {
    expect(
      parseRuntimeSlotIssuePayload({
        contentType: "application/json",
        expiresAt: "2026-01-01T00:00:00.000Z",
        extension: "json",
        kind: "segment",
        maxBytes: 1_000_000,
        sequenceNumber: 3810,
        trackId: "v1080",
        slotId: "slot_3810",
      }).extension
    ).toBe("json");
  });
});
