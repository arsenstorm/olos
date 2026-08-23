import { describe, expect, test } from "bun:test";

import {
  parseRuntimeSlotIssuePayload,
  parseSlotIssueRequest,
} from "./slot-issue-payload";

describe("runtime slot issue payload parser", () => {
  test("parses intent payloads for slot issue requests", () => {
    const payload = parseRuntimeSlotIssuePayload({
      contentType: "video/mp4",
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "segment",
      maxBytes: 1_000_000,
      minBytes: 1,
      profile: { duration: 2 },
      sequenceNumber: 3810,
      slotId: "slot_3810",
      trackId: "v1080",
    });

    expect(payload).toEqual({
      contentType: "video/mp4",
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "segment",
      maxBytes: 1_000_000,
      minBytes: 1,
      profile: { duration: 2 },
      sequenceNumber: 3810,
      slotId: "slot_3810",
      trackId: "v1080",
    });
  });

  test("omits profile when the payload carries none", () => {
    const payload = parseRuntimeSlotIssuePayload({
      contentType: "application/octet-stream",
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "segment",
      maxBytes: 1_000_000,
      sequenceNumber: 3810,
      slotId: "slot_3810",
      trackId: "v1080",
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
          slotId: "slot_3810",
          trackId: "v1080",
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
      slotId: "slot_init",
      trackId: "v1080",
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
      objectKeyNonce: "slot_01JZ",
      objectKeyPrefix: "live/session",
      sequenceNumber: 3810,
      slotId: "slot_3810",
      trackId: "v1080",
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
        objectKey: "any/key.m4s",
        sequenceNumber: 3810,
        slotId: "slot_3810",
        trackId: "v1080",
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
        slotId: "slot_3810",
        trackId: "v1080",
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
        partNumber: 0,
        sequenceNumber: 3810,
        slotId: "slot_3810",
        trackId: "v1080",
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
        slotId: "slot_3810_p0",
        trackId: "v1080",
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
      slotId: "slot_3810",
      trackId: "v1080",
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
        slotId: "slot_3810",
        trackId: "v1080",
      }).extension
    ).toBe("json");
  });
});

const slotPayload = {
  contentType: "video/mp4",
  expiresAt: "2026-01-01T00:00:05.000Z",
  kind: "segment",
  maxBytes: 100_000,
  profile: { duration: 2 },
  sequenceNumber: 3810,
  slotId: "slot_3810",
  trackId: "v1080",
} as const;

describe("runtime slot issue request parser", () => {
  test("parses direct slot issue payload objects", async () => {
    await expect(parseSlotIssue(slotPayload)).resolves.toEqual({
      status: "valid",
      value: slotPayload,
    });
  });

  test("parses slot issue payload requests", async () => {
    await expect(parseSlotIssue(jsonRequest(slotPayload))).resolves.toEqual({
      status: "valid",
      value: slotPayload,
    });
  });

  test("rejects non-object slot issue payloads", async () => {
    await expect(parseSlotIssue(jsonRequest(123))).resolves.toEqual({
      message: "slot issue request must be a JSON object",
      status: "invalid",
    });
  });

  test("maps malformed slot issue JSON to request errors", async () => {
    await expect(
      parseSlotIssue(
        new Request("https://edge.example.com/sessions/session_1/slots", {
          body: "{",
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      )
    ).resolves.toEqual({
      message: "JSON Parse error: Expected '}'",
      status: "invalid",
    });
  });
});

function parseSlotIssue(request: Request | typeof slotPayload) {
  return parseSlotIssueRequest(
    request,
    (message) => ({ message, status: "invalid" as const }),
    "invalid slot issue request"
  );
}

function jsonRequest(body: unknown): Request {
  return new Request("https://edge.example.com/sessions/session_1/slots", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}
