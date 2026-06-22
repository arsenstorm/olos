import { describe, expect, test } from "bun:test";
import {
  assertHttpHeaderStringMap,
  isHttpHeaderName,
  isHttpHeaderStringMap,
  isOptionalHttpHeaderStringMap,
} from "./http-header";

describe("HTTP header validation", () => {
  test("validates HTTP header names", () => {
    expect(isHttpHeaderName("x-olos-slot-id")).toBe(true);
    expect(isHttpHeaderName("bad header")).toBe(false);
    expect(isHttpHeaderName("bad:header")).toBe(false);
  });

  test("validates required string maps", () => {
    expect(isHttpHeaderStringMap({ "x-olos-slot-id": "slot_1" })).toBe(true);
    expect(isHttpHeaderStringMap(null)).toBe(false);
    expect(isHttpHeaderStringMap({ "bad header": "slot_1" })).toBe(false);
    expect(isHttpHeaderStringMap({ "x-olos-slot-id": undefined })).toBe(false);
  });

  test("validates optional string maps", () => {
    expect(isOptionalHttpHeaderStringMap(null)).toBe(false);
    expect(isOptionalHttpHeaderStringMap({ "x-olos-slot-id": undefined })).toBe(
      true
    );
    expect(isOptionalHttpHeaderStringMap({ "bad header": undefined })).toBe(
      false
    );
  });

  test("asserts required string maps", () => {
    expect(() =>
      assertHttpHeaderStringMap({ "x-olos-slot-id": "slot_1" }, "headers")
    ).not.toThrow();
    expect(() =>
      assertHttpHeaderStringMap({ "x-olos-slot-id": undefined }, "headers")
    ).toThrow("headers must be a string map");
  });
});
