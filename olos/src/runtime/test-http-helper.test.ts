import { describe, expect, test } from "bun:test";
import {
  jsonErrorTestResponse,
  jsonPostRequest,
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

  test("creates JSON error responses", async () => {
    const response = jsonErrorTestResponse("missing", 404);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ error: { message: "missing" } });
  });
});
