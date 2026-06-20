import { describe, expect, test } from "bun:test";
import {
  jsonPost,
  normalizedBaseUrl,
  optionalRecordField,
  optionalRecordPayload,
  requiredRecordField,
  responseBody,
} from "./http-client";

describe("runtime HTTP client helpers", () => {
  test("jsonPost creates JSON POST request init", () => {
    expect(jsonPost({ ok: true })).toEqual({
      body: '{"ok":true}',
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  });

  test("normalizedBaseUrl preserves and adds trailing slashes", () => {
    expect(normalizedBaseUrl("https://edge.example.com")).toBe(
      "https://edge.example.com/"
    );
    expect(normalizedBaseUrl("https://edge.example.com/")).toBe(
      "https://edge.example.com/"
    );
  });

  test("record field helpers extract object fields", () => {
    const value = {
      cursor: { sessionId: "session_1" },
      text: "not an object",
    };

    expect(optionalRecordField(value, "cursor")).toEqual({
      sessionId: "session_1",
    });
    expect(optionalRecordField(value, "text")).toBeUndefined();
    expect(
      optionalRecordPayload<"cursor", { sessionId: string }>(value, "cursor")
    ).toEqual({
      cursor: { sessionId: "session_1" },
    });
    expect(requiredRecordField(value, "cursor", "missing cursor")).toEqual({
      sessionId: "session_1",
    });
    expect(() =>
      requiredRecordField(value, "missing", "missing cursor")
    ).toThrow("missing cursor");
  });

  test("responseBody parses JSON, text, and empty responses", async () => {
    await expect(responseBody(new Response('{"ok":true}'))).resolves.toEqual({
      ok: true,
    });
    await expect(responseBody(new Response("plain text"))).resolves.toBe(
      "plain text"
    );
    await expect(responseBody(new Response(""))).resolves.toBeUndefined();
  });
});
