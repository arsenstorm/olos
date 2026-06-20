import { describe, expect, test } from "bun:test";
import { recordValue } from "../validation/fields";
import { parseRuntimeJsonRequest } from "./request-json";

describe("parseRuntimeJsonRequest", () => {
  test("passes through already parsed values", async () => {
    await expect(
      parseRuntimeJsonRequest(
        { ok: true },
        parseObject,
        invalidParse,
        "invalid request"
      )
    ).resolves.toEqual({
      status: "valid",
      value: { ok: true },
    });
  });

  test("parses JSON request bodies", async () => {
    await expect(
      parseRuntimeJsonRequest(
        new Request("https://edge.example.com", {
          body: '{"ok":true}',
          method: "POST",
        }),
        parseObject,
        invalidParse,
        "invalid request"
      )
    ).resolves.toEqual({
      status: "valid",
      value: { ok: true },
    });
  });

  test("returns invalid parse results for parser errors", async () => {
    await expect(
      parseRuntimeJsonRequest(
        new Request("https://edge.example.com", {
          body: '"not an object"',
          method: "POST",
        }),
        parseObject,
        invalidParse,
        "invalid request"
      )
    ).resolves.toEqual({
      message: "payload must be an object",
      status: "invalid",
    });
  });

  test("returns fallback invalid results for non-Error JSON failures", async () => {
    await expect(
      parseRuntimeJsonRequest(
        new Request("https://edge.example.com", {
          body: "{",
          method: "POST",
        }),
        parseObject,
        invalidParse,
        "invalid request"
      )
    ).resolves.toEqual({
      message: "Failed to parse JSON",
      status: "invalid",
    });
  });
});

function parseObject(value: unknown): Record<string, unknown> {
  const record = recordValue(value);

  if (record === undefined) {
    throw new Error("payload must be an object");
  }

  return record;
}

function invalidParse(message: string): { message: string; status: "invalid" } {
  return { message, status: "invalid" };
}
