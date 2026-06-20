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
  hasControlCharacter,
  isRecord,
  nonNegativeNumber,
  positiveNumber,
  recordValue,
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

  test("numeric helpers return valid values and reject invalid values", () => {
    expect(positiveNumber(1, "duration")).toBe(1);
    expect(nonNegativeNumber(0, "duration")).toBe(0);
    expect(() => positiveNumber(0, "duration")).toThrow(
      "duration must be a positive number"
    );
    expect(() => nonNegativeNumber(-1, "duration")).toThrow(
      "duration must be a non-negative number"
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
    expect(() => assertAbsoluteHttpUrl("ftp://example.com", "baseUrl")).toThrow(
      "baseUrl must be an absolute HTTP(S) URL"
    );
    expect(() =>
      assertAbsoluteHttpUrl("https://media.example.com/live?x=1", "baseUrl")
    ).toThrow("baseUrl must not contain query strings or fragments");
  });
});
