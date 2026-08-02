import { describe, expect, test } from "bun:test";
import { createOlosError } from "../types/errors";
import {
  jsonBadRequestResponse,
  jsonConflictResponse,
  jsonErrorResponse,
  jsonMethodNotAllowedResponse,
  jsonNotFoundResponse,
  jsonOlosErrorResponse,
  jsonResponse,
} from "./response";
import { expectOlosErrorEnvelope } from "./test-error-envelope.test-helper";

describe("runtime JSON responses", () => {
  test("jsonResponse serializes bodies with JSON content type", async () => {
    const response = jsonResponse({ ok: true }, 202);

    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8"
    );
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test("jsonErrorResponse serializes coded error messages", async () => {
    const response = jsonErrorResponse(
      "olos.invalid_session",
      "missing session",
      404
    );

    expect(response.status).toBe(404);
    await expectOlosErrorEnvelope(response);
    await expect(response.json()).resolves.toEqual({
      error: { code: "olos.invalid_session", message: "missing session" },
    });
  });

  test("jsonOlosErrorResponse serializes pre-built OLOS errors", async () => {
    const error = createOlosError("olos.slot_expired", "slot expired", {
      slotId: "slot_1",
    });
    const response = jsonOlosErrorResponse(error, 409);

    expect(response.status).toBe(409);
    await expectOlosErrorEnvelope(response);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "olos.slot_expired",
        details: { slotId: "slot_1" },
        message: "slot expired",
      },
    });
  });

  test("jsonBadRequestResponse creates 400 JSON errors", async () => {
    const response = jsonBadRequestResponse("invalid request");

    expect(response.status).toBe(400);
    await expectOlosErrorEnvelope(response);
    await expect(response.json()).resolves.toEqual({
      error: { code: "olos.invalid_request", message: "invalid request" },
    });
  });

  test("jsonNotFoundResponse creates 404 JSON errors", async () => {
    const response = jsonNotFoundResponse("route not found");

    expect(response.status).toBe(404);
    await expectOlosErrorEnvelope(response);
    await expect(response.json()).resolves.toEqual({
      error: { code: "olos.not_found", message: "route not found" },
    });
  });

  test("jsonMethodNotAllowedResponse creates 405 JSON errors", async () => {
    const response = jsonMethodNotAllowedResponse(["GET", "POST"]);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8"
    );
    await expectOlosErrorEnvelope(response);
    await expect(response.json()).resolves.toEqual({
      error: { code: "olos.method_not_allowed", message: "method not allowed" },
    });
  });

  test("jsonConflictResponse creates 409 JSON errors", async () => {
    const response = jsonConflictResponse("session changed");

    expect(response.status).toBe(409);
    await expectOlosErrorEnvelope(response);
    await expect(response.json()).resolves.toEqual({
      error: { code: "olos.conflict", message: "session changed" },
    });
  });
});
