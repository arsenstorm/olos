import { describe, expect, test } from "bun:test";
import {
  booleanField,
  isRecord,
  nonNegativeInteger,
  nonNegativeIntegerField,
  nonNegativeNumber,
  nonNegativeNumberField,
  nonNegativeSafeInteger,
  numberField,
  oneOfStringField,
  optionalBooleanField,
  optionalNonNegativeIntegerField,
  optionalNonNegativeNumberField,
  optionalPositiveIntegerField,
  optionalStringField,
  optionalTimestampField,
  optionalTimestampValueField,
  optionalUrlSafeIdentifierValueField,
  positiveInteger,
  positiveIntegerField,
  positiveNumber,
  positiveNumberField,
  positiveSafeInteger,
  stringField,
  timestampField,
  timestampMs,
  urlSafeIdentifierField,
} from "./request-fields";

describe("runtime request field helpers", () => {
  test("isRecord rejects arrays and null values", () => {
    expect(isRecord({ ok: true })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });

  test("validates required scalar fields", () => {
    const value = {
      active: true,
      count: 2,
      mode: "live",
      sessionId: "session_1",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(stringField(value, "mode")).toBe("live");
    expect(oneOfStringField(value, "mode", ["live", "ended"] as const)).toBe(
      "live"
    );
    expect(urlSafeIdentifierField(value, "sessionId")).toBe("session_1");
    expect(numberField(value, "count")).toBe(2);
    expect(booleanField(value, "active")).toBe(true);
    expect(timestampField(value, "updatedAt")).toBe("2026-01-01T00:00:00.000Z");
  });

  test("rejects invalid required scalar fields", () => {
    expect(() => stringField({ value: 1 }, "value")).toThrow(
      "value must be a string"
    );
    expect(() =>
      oneOfStringField({ mode: "paused" }, "mode", ["live"] as const)
    ).toThrow("mode must be one of: live");
    expect(() => urlSafeIdentifierField({ id: "bad id" }, "id")).toThrow(
      "id must be a non-empty URL-safe identifier"
    );
    expect(() =>
      numberField({ value: Number.POSITIVE_INFINITY }, "value")
    ).toThrow("value must be a finite number");
    expect(() => booleanField({ active: "yes" }, "active")).toThrow(
      "active must be a boolean"
    );
    expect(() => timestampField({ updatedAt: "later" }, "updatedAt")).toThrow(
      "updatedAt must be a valid timestamp"
    );
  });

  test("validates numeric helper functions", () => {
    expect(nonNegativeNumber(0, "latency")).toBe(0);
    expect(positiveNumber(0.5, "latency")).toBe(0.5);
    expect(nonNegativeInteger(0, "count")).toBe(0);
    expect(positiveInteger(1, "count")).toBe(1);
    expect(nonNegativeSafeInteger(Number.MAX_SAFE_INTEGER, "count")).toBe(
      Number.MAX_SAFE_INTEGER
    );
    expect(positiveSafeInteger(Number.MAX_SAFE_INTEGER, "count")).toBe(
      Number.MAX_SAFE_INTEGER
    );
    expect(nonNegativeNumberField({ value: 0 }, "value")).toBe(0);
    expect(positiveNumberField({ value: 1 }, "value")).toBe(1);
    expect(nonNegativeIntegerField({ value: 0 }, "value")).toBe(0);
    expect(positiveIntegerField({ value: 1 }, "value")).toBe(1);
  });

  test("rejects invalid numeric helper values", () => {
    expect(() => nonNegativeNumber(-1, "latency")).toThrow(
      "latency must be a non-negative number"
    );
    expect(() => positiveNumber(0, "latency")).toThrow(
      "latency must be a positive number"
    );
    expect(() => nonNegativeInteger(1.5, "count")).toThrow(
      "count must be a non-negative integer"
    );
    expect(() => positiveInteger(0, "count")).toThrow(
      "count must be a positive integer"
    );
    expect(() =>
      nonNegativeSafeInteger(Number.MAX_SAFE_INTEGER + 1, "count")
    ).toThrow("count must be a non-negative integer");
    expect(() =>
      positiveSafeInteger(Number.MAX_SAFE_INTEGER + 1, "count")
    ).toThrow("count must be a positive integer");
  });

  test("optional helpers include defined valid fields and omit missing fields", () => {
    const value = {
      active: false,
      count: 2,
      id: "slot_1",
      label: "primary",
      latency: 1.5,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(optionalStringField(value, "label")).toEqual({ label: "primary" });
    expect(optionalBooleanField(value, "active")).toEqual({ active: false });
    expect(optionalNonNegativeNumberField(value, "latency")).toEqual({
      latency: 1.5,
    });
    expect(optionalNonNegativeIntegerField(value, "count")).toEqual({
      count: 2,
    });
    expect(optionalPositiveIntegerField(value, "count")).toEqual({ count: 2 });
    expect(optionalTimestampField(value, "updatedAt")).toEqual({
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(optionalTimestampValueField(value, "updatedAt")).toBe(
      "2026-01-01T00:00:00.000Z"
    );
    expect(optionalUrlSafeIdentifierValueField(value, "id")).toBe("slot_1");

    expect(optionalStringField({}, "label")).toEqual({});
    expect(optionalTimestampValueField({}, "updatedAt")).toBeUndefined();
    expect(optionalUrlSafeIdentifierValueField({}, "id")).toBeUndefined();
  });

  test("optional helpers validate defined invalid fields", () => {
    expect(() => optionalBooleanField({ active: "false" }, "active")).toThrow(
      "active must be a boolean"
    );
    expect(() => optionalStringField({ label: null }, "label")).toThrow(
      "label must be a string"
    );
    expect(() =>
      optionalTimestampValueField({ updatedAt: "later" }, "updatedAt")
    ).toThrow("updatedAt must be a valid timestamp");
  });

  test("timestampMs accepts dates and timestamp strings", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";

    expect(timestampMs(timestamp, "now")).toBe(Date.parse(timestamp));
    expect(timestampMs(new Date(timestamp), "now")).toBe(Date.parse(timestamp));
    expect(() => timestampMs("later", "now")).toThrow(
      "now must be a valid timestamp"
    );
  });
});
