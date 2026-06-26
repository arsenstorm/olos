import { describe, expect, test } from "bun:test";
import {
  assertAbsoluteHttpUrl,
  assertBooleanField,
  assertIsoDateField,
  assertNonEmptyStringField,
  assertNonNegativeIntegerField,
  assertOneOfField,
  assertPositiveIntegerField,
  assertPositiveNumberField,
  assertUrlSafeField,
  booleanValue,
  finiteNumber,
  hasControlCharacter,
  isRecord,
  nonEmptyArray,
  nonNegativeNumber,
  parseAbsoluteHttpUrl,
  positiveNumber,
  recordValue,
  stringValue,
  timestampString,
} from "./fields";

describe("validation field helpers", () => {
  test("isRecord rejects arrays and null values", () => {
    expect(isRecord({ ok: true })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(recordValue({ ok: true })).toEqual({ ok: true });
    expect(recordValue([])).toBeUndefined();
  });

  test("field assertions accept valid values", () => {
    const value = {
      active: true,
      count: 1,
      id: "session_1",
      mode: "live",
      name: "primary",
      ratio: 0.5,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(() => assertUrlSafeField(value, "id", "session")).not.toThrow();
    expect(() =>
      assertNonNegativeIntegerField(value, "count", "session")
    ).not.toThrow();
    expect(() =>
      assertPositiveIntegerField(value, "count", "session")
    ).not.toThrow();
    expect(() =>
      assertPositiveNumberField(value, "ratio", "session")
    ).not.toThrow();
    expect(() =>
      assertNonEmptyStringField(value, "name", "session")
    ).not.toThrow();
    expect(() => assertBooleanField(value, "active", "session")).not.toThrow();
    expect(() =>
      assertIsoDateField(value, "updatedAt", "session")
    ).not.toThrow();
    expect(
      assertOneOfField(value, "mode", ["live", "ended"] as const, "session")
    ).toBe("live");
  });

  test("field assertions reject invalid values with named messages", () => {
    expect(() => assertUrlSafeField({ id: "bad id" }, "id", "session")).toThrow(
      "session.id must be a non-empty URL-safe identifier"
    );
    expect(() =>
      assertNonNegativeIntegerField({ count: -1 }, "count", "session")
    ).toThrow("session.count must be a non-negative integer");
    expect(() =>
      assertPositiveIntegerField({ count: 0 }, "count", "session")
    ).toThrow("session.count must be a positive integer");
    expect(() =>
      assertPositiveNumberField({ ratio: 0 }, "ratio", "session")
    ).toThrow("session.ratio must be a positive number");
    expect(() =>
      assertNonEmptyStringField({ name: "" }, "name", "session")
    ).toThrow("session.name must be a non-empty string");
    expect(() =>
      assertBooleanField({ active: "yes" }, "active", "session")
    ).toThrow("session.active must be a boolean");
    expect(() =>
      assertIsoDateField({ updatedAt: "later" }, "updatedAt", "session")
    ).toThrow("session.updatedAt must be a valid timestamp");
    expect(() =>
      assertOneOfField({ mode: "paused" }, "mode", ["live"] as const, "session")
    ).toThrow("session.mode must be one of: live");
  });

  test("field assertions preserve nested field names in error messages", () => {
    expect(() =>
      assertUrlSafeField({ id: "bad id" }, "id", "session.renditions[]")
    ).toThrow(
      "session.renditions[].id must be a non-empty URL-safe identifier"
    );
  });

  test("numeric helpers return valid values and reject invalid values", () => {
    expect(positiveNumber(1, "duration")).toBe(1);
    expect(nonNegativeNumber(0, "duration")).toBe(0);
    expect(finiteNumber(0, "duration")).toBe(0);
    expect(() => positiveNumber(0, "duration")).toThrow(
      "duration must be a positive number"
    );
    expect(() => nonNegativeNumber(-1, "duration")).toThrow(
      "duration must be a non-negative number"
    );
    expect(() => nonNegativeNumber(Number.NaN, "duration")).toThrow(
      "duration must be a non-negative number"
    );
    expect(() => finiteNumber(Number.POSITIVE_INFINITY, "duration")).toThrow(
      "duration must be a finite number"
    );
  });

  test("scalar helpers return valid values and reject invalid values", () => {
    expect(stringValue("live", "state")).toBe("live");
    expect(booleanValue(false, "active")).toBe(false);
    expect(timestampString("2026-01-01T00:00:00.000Z", "updatedAt")).toBe(
      "2026-01-01T00:00:00.000Z"
    );
    expect(() => stringValue(1, "state")).toThrow("state must be a string");
    expect(() => booleanValue("false", "active")).toThrow(
      "active must be a boolean"
    );
    expect(() => timestampString("later", "updatedAt")).toThrow(
      "updatedAt must be a valid timestamp"
    );
  });

  test("nonEmptyArray returns arrays and rejects empty or non-array values", () => {
    expect(nonEmptyArray(["v1080"], "renditions")).toEqual(["v1080"]);
    expect(() => nonEmptyArray([], "renditions")).toThrow(
      "renditions must be a non-empty array"
    );
    expect(() => nonEmptyArray("v1080", "renditions")).toThrow(
      "renditions must be a non-empty array"
    );
  });

  test("detects ASCII control characters", () => {
    expect(hasControlCharacter("safe/path")).toBe(false);
    expect(hasControlCharacter("bad\npath")).toBe(true);
    expect(hasControlCharacter(`bad${String.fromCharCode(0x7f)}path`)).toBe(
      true
    );
  });

  test("validates absolute HTTP URLs without query strings or fragments", () => {
    expect(() =>
      assertAbsoluteHttpUrl("https://media.example.com/live", "baseUrl")
    ).not.toThrow();
    expect(() => assertAbsoluteHttpUrl("", "baseUrl")).toThrow(
      "baseUrl must be an absolute HTTP(S) URL"
    );
    expect(() => assertAbsoluteHttpUrl("ftp://example.com", "baseUrl")).toThrow(
      "baseUrl must be an absolute HTTP(S) URL"
    );
    expect(() =>
      assertAbsoluteHttpUrl("https://media.example.com/live?x=1", "baseUrl")
    ).toThrow("baseUrl must not contain query strings or fragments");
    expect(() =>
      assertAbsoluteHttpUrl("https://media.example.com/live#frag", "baseUrl")
    ).toThrow("baseUrl must not contain query strings or fragments");
  });

  test("allows absolute HTTP URL query strings when requested", () => {
    const url = parseAbsoluteHttpUrl(
      "https://media.example.com/live?x=1#frag",
      "baseUrl",
      { allowQueryOrFragment: true }
    );

    expect(url.search).toBe("?x=1");
    expect(url.hash).toBe("#frag");
  });
});
