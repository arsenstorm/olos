import { describe, expect, test } from "bun:test";
import {
  jsonBadRequestResponse,
  jsonErrorResponse,
  jsonMethodNotAllowedResponse,
  jsonResponse,
} from "./response";

describe("runtime JSON responses", () => {
  test("jsonResponse serializes bodies with JSON content type", async () => {
    const response = jsonResponse({ ok: true }, 202);

    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8"
    );
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test("jsonErrorResponse serializes error messages", async () => {
    const response = jsonErrorResponse("missing session", 404);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { message: "missing session" },
    });
  });

  test("jsonBadRequestResponse creates 400 JSON errors", async () => {
    const response = jsonBadRequestResponse("invalid request");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { message: "invalid request" },
    });
  });

  test("jsonMethodNotAllowedResponse creates 405 JSON errors", async () => {
    const response = jsonMethodNotAllowedResponse();

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: { message: "method not allowed" },
    });
  });
});
