import { describe, expect, test } from "bun:test";
import { runtimeFetchFor } from "./test-fetch.test-helper";

describe("runtimeFetchFor", () => {
  test("passes Request instances through to handlers", async () => {
    const request = new Request("https://edge.example.com/health");
    let handledRequest: Request | undefined;
    const fetch = runtimeFetchFor((input) => {
      handledRequest = input;
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    const response = await fetch(request);

    expect(response.status).toBe(204);
    expect(handledRequest).toBe(request);
  });

  test("converts URL inputs and init options to Request instances", async () => {
    let handledRequest: Request | undefined;
    const fetch = runtimeFetchFor((input) => {
      handledRequest = input;
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    await fetch("https://edge.example.com/sessions", { method: "POST" });

    expect(handledRequest).toBeInstanceOf(Request);
    expect(handledRequest?.method).toBe("POST");
    expect(handledRequest?.url).toBe("https://edge.example.com/sessions");
  });

  test("converts URL objects to Request instances", async () => {
    let handledRequest: Request | undefined;
    const fetch = runtimeFetchFor((input) => {
      handledRequest = input;
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    await fetch(new URL("https://edge.example.com/live"));

    expect(handledRequest).toBeInstanceOf(Request);
    expect(handledRequest?.url).toBe("https://edge.example.com/live");
  });
});
