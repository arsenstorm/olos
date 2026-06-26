import { describe, expect, test } from "bun:test";
import {
  isRecord,
  jsonPost,
  normalizedBaseUrl,
  optionalRecordField,
  optionalRecordPayload,
  requiredArrayField,
  requiredRecord,
  requiredRecordField,
  requiredStringField,
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
    const assertCursorRecord = (
      value: unknown
    ): asserts value is { sessionId: string } => {
      if (!isRecord(value)) {
        throw new Error("cursor must be an object");
      }

      if (typeof value.sessionId !== "string") {
        throw new Error("cursor.sessionId must be a string");
      }
    };

    expect(optionalRecordField(value, "cursor")).toEqual({
      sessionId: "session_1",
    });
    expect(optionalRecordField(value, "text")).toBeUndefined();
    expect(
      optionalRecordPayload<"cursor", { sessionId: string }>(
        value,
        "cursor",
        assertCursorRecord
      )
    ).toEqual({
      cursor: { sessionId: "session_1" },
    });
    expect(requiredRecordField(value, "cursor", "missing cursor")).toEqual({
      sessionId: "session_1",
    });
    expect(requiredRecord(value, "missing record")).toBe(value);
    expect(() =>
      requiredRecordField(value, "missing", "missing cursor")
    ).toThrow("missing cursor");
    expect(() => requiredRecord(null, "missing record")).toThrow(
      "missing record"
    );
  });

  test("required field helpers extract scalar and array fields", () => {
    const value = {
      results: [{ status: "committed" }],
      status: "planned",
    };

    expect(requiredStringField(value, "status", "missing status")).toBe(
      "planned"
    );
    expect(requiredArrayField(value, "results", "missing results")).toEqual([
      { status: "committed" },
    ]);
    expect(() =>
      requiredStringField(value, "results", "missing status")
    ).toThrow("missing status");
    expect(() =>
      requiredArrayField(value, "status", "missing results")
    ).toThrow("missing results");
  });

  test("field helpers handle non-object payloads through their normal missing-field paths", () => {
    expect(optionalRecordField(null, "cursor")).toBeUndefined();
    expect(
      optionalRecordPayload<"cursor", { sessionId: string }>(
        null,
        "cursor",
        () => {
          throw new Error("assertion should not run");
        }
      )
    ).toEqual({});
    expect(() => requiredStringField(null, "status", "missing status")).toThrow(
      "missing status"
    );
    expect(() =>
      requiredArrayField(null, "results", "missing results")
    ).toThrow("missing results");
  });

  test("responseBody parses JSON, text, and empty responses", async () => {
    await expect(responseBody(new Response('{"ok":true}'))).resolves.toEqual({
      ok: true,
    });
    await expect(responseBody(new Response("{bad json"))).resolves.toBe(
      "{bad json"
    );
    await expect(responseBody(new Response("plain text"))).resolves.toBe(
      "plain text"
    );
    await expect(responseBody(new Response(""))).resolves.toBeUndefined();
  });
});
