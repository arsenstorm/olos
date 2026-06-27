import { describe, expect, test } from "bun:test";

import { parseRuntimeSlotIssuePayloadRequest } from "./slot-issue-request-parser";

const slotPayload = {
  contentType: "video/mp4",
  duration: 2,
  expiresAt: "2026-01-01T00:00:05.000Z",
  kind: "segment",
  maxBytes: 100_000,
  mediaSequenceNumber: 3810,
  renditionId: "v1080",
  slotId: "slot_3810",
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
      message: "Failed to parse JSON",
      status: "invalid",
    });
  });
});

function parseSlotIssue(request: Request | typeof slotPayload) {
  return parseRuntimeSlotIssuePayloadRequest(
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
