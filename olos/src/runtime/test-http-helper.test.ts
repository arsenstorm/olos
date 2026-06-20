import { describe, expect, test } from "bun:test";
import {
  jsonErrorTestResponse,
  jsonPostRequest,
  jsonResponseBody,
  jsonResponseStatusAndBody,
  rawOrJsonPostRequest,
} from "./test-http.test-helper";

describe("test HTTP helpers", () => {
  test("creates JSON POST requests", async () => {
    const request = jsonPostRequest("https://edge.example.com/sessions", {
      ok: true,
    });

    expect(request.method).toBe("POST");
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(await request.json()).toEqual({ ok: true });
  });

  test("creates raw or JSON POST requests", async () => {
    const rawRequest = rawOrJsonPostRequest(
      "https://edge.example.com/slots",
      "{"
    );
    const jsonRequest = rawOrJsonPostRequest("https://edge.example.com/slots", {
      ok: true,
    });

    expect(rawRequest.method).toBe("POST");
    expect(await rawRequest.text()).toBe("{");
    expect(jsonRequest.method).toBe("POST");
    expect(await jsonRequest.json()).toEqual({ ok: true });
  });

  test("creates JSON error responses", async () => {
    const response = jsonErrorTestResponse("missing", 404);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ error: { message: "missing" } });
  });

  test("reads typed JSON response bodies", async () => {
    const body = await jsonResponseBody<{ ok: boolean }>(
      new Response('{"ok":true}')
    );

    expect(body.ok).toBe(true);
  });

  test("reads JSON response status and bodies", async () => {
    await expect(
      jsonResponseStatusAndBody<{ ok: boolean }>(
        new Response('{"ok":true}', { status: 202 })
      )
    ).resolves.toEqual({
      body: { ok: true },
      status: 202,
    });
  });
});
