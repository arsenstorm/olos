import { describe, expect, test } from "bun:test";

import { parseS3RetentionRequest } from "./http-request-parser";

describe("S3 HTTP request parser", () => {
  test("parses S3 retention request payloads", async () => {
    await expect(
      parseS3RetentionRequest(jsonRequest({ now: "2026-01-01T00:00:06.000Z" }))
    ).resolves.toEqual({
      payload: { now: "2026-01-01T00:00:06.000Z" },
      status: "valid",
    });
  });

  test("rejects non-object S3 retention request payloads", async () => {
    await expect(parseS3RetentionRequest(jsonRequest(123))).resolves.toEqual({
      message: "S3 retention request must be a JSON object",
      status: "invalid",
    });
  });

  test("maps S3 retention field parser errors to request errors", async () => {
    await expect(
      parseS3RetentionRequest(jsonRequest({ now: "soon" }))
    ).resolves.toEqual({
      message: "now must be a valid timestamp",
      status: "invalid",
    });
  });

  test("maps malformed S3 retention JSON to request errors", async () => {
    await expect(
      parseS3RetentionRequest(
        new Request(
          "https://edge.example.com/sessions/session_1/s3/retention",
          {
            body: "{",
            headers: { "content-type": "application/json" },
            method: "POST",
          }
        )
      )
    ).resolves.toEqual({
      message: "Failed to parse JSON",
      status: "invalid",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request(
    "https://edge.example.com/sessions/session_1/s3/retention",
    {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  );
}
