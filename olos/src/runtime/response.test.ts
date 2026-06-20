import { describe, expect, test } from "bun:test";
import { jsonErrorResponse, jsonResponse } from "./response";

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
});
