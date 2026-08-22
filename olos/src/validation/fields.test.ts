import { describe, expect, test } from "bun:test";
import {
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
  isAllowedString,
  isRecord,
  type KnownFieldsShape,
  nonEmptyArray,
  nonNegativeNumber,
  positiveNumber,
  pruneUnknownFields,
  recordValue,
  stringValue,
  timestampMs,
  timestampString,
} from "./fields";
import { assertAbsoluteHttpUrl, parseAbsoluteHttpUrl } from "./http-url";

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
    expect(() =>
      assertOneOfField(value, "mode", ["live", "ended"] as const, "session")
    ).not.toThrow();
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
      assertUrlSafeField({ id: "bad id" }, "id", "session.tracks[]")
    ).toThrow("session.tracks[].id must be a non-empty URL-safe identifier");
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

  test("timestampString accepts RFC 3339 date-time variants", () => {
    expect(timestampString("2026-01-01T00:00:00Z", "updatedAt")).toBe(
      "2026-01-01T00:00:00Z"
    );
    expect(timestampString("2026-01-01T00:00:00+02:00", "updatedAt")).toBe(
      "2026-01-01T00:00:00+02:00"
    );
    expect(timestampString("2026-01-01t00:00:00.500z", "updatedAt")).toBe(
      "2026-01-01t00:00:00.500z"
    );
  });

  test("timestampString accepts leap-day dates in leap years", () => {
    expect(timestampString("2024-02-29T00:00:00Z", "updatedAt")).toBe(
      "2024-02-29T00:00:00Z"
    );
    expect(timestampString("2000-02-29T00:00:00Z", "updatedAt")).toBe(
      "2000-02-29T00:00:00Z"
    );
  });

  test("timestampString rejects non-RFC 3339 Date.parse-able strings", () => {
    expect(() => timestampString("2026-01-01", "updatedAt")).toThrow(
      "updatedAt must be a valid timestamp"
    );
    expect(() => timestampString("Jan 1 2026", "updatedAt")).toThrow(
      "updatedAt must be a valid timestamp"
    );
    expect(() => timestampString("2026-01-01 00:00:00Z", "updatedAt")).toThrow(
      "updatedAt must be a valid timestamp"
    );
    expect(() => timestampString("2026-13-01T00:00:00Z", "updatedAt")).toThrow(
      "updatedAt must be a valid timestamp"
    );
  });

  test("timestampString rejects impossible calendar dates", () => {
    expect(() => timestampString("2026-02-30T00:00:00Z", "updatedAt")).toThrow(
      "updatedAt must be a valid timestamp"
    );
    expect(() => timestampString("2026-04-31T00:00:00Z", "updatedAt")).toThrow(
      "updatedAt must be a valid timestamp"
    );
    expect(() => timestampString("2026-02-29T00:00:00Z", "updatedAt")).toThrow(
      "updatedAt must be a valid timestamp"
    );
    expect(() => timestampString("2100-02-29T00:00:00Z", "updatedAt")).toThrow(
      "updatedAt must be a valid timestamp"
    );
    expect(() => timestampString("2026-00-01T00:00:00Z", "updatedAt")).toThrow(
      "updatedAt must be a valid timestamp"
    );
    expect(() => timestampString("2026-01-00T00:00:00Z", "updatedAt")).toThrow(
      "updatedAt must be a valid timestamp"
    );
  });

  test("timestampString rejects times epoch milliseconds cannot represent", () => {
    expect(() => timestampString("2026-01-01T24:00:00Z", "updatedAt")).toThrow(
      "updatedAt must be a valid timestamp"
    );
    expect(() => timestampString("2026-12-31T23:59:60Z", "updatedAt")).toThrow(
      "updatedAt must be a valid timestamp"
    );
    expect(() =>
      timestampString("2026-01-01T00:00:00+0100", "updatedAt")
    ).toThrow("updatedAt must be a valid timestamp");
    expect(() =>
      timestampString("2026-01-01T00:00:00+24:00", "updatedAt")
    ).toThrow("updatedAt must be a valid timestamp");
  });

  test("timestampMs returns milliseconds for valid timestamps", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";

    expect(timestampMs(timestamp, "now")).toBe(Date.parse(timestamp));
  });

  test("timestampMs rejects invalid timestamps", () => {
    expect(() => timestampMs("later", "now")).toThrow(
      "now must be a valid timestamp"
    );
  });

  test("isAllowedString accepts values from the allowed string set", () => {
    expect(isAllowedString("live", ["created", "live"] as const)).toBe(true);
    expect(isAllowedString("ended", ["created", "live"] as const)).toBe(false);
    expect(isAllowedString(1, ["created", "live"] as const)).toBe(false);
  });

  test("nonEmptyArray returns arrays and rejects empty or non-array values", () => {
    expect(nonEmptyArray(["v1080"], "tracks")).toEqual(["v1080"]);
    expect(() => nonEmptyArray([], "tracks")).toThrow(
      "tracks must be a non-empty array"
    );
    expect(() => nonEmptyArray("v1080", "tracks")).toThrow(
      "tracks must be a non-empty array"
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

describe("pruneUnknownFields", () => {
  const shape: KnownFieldsShape = {
    fields: ["entries", "id", "labels", "nested"],
    nested: {
      entries: { kind: "array", shape: { fields: ["value"] } },
      labels: { kind: "map", shape: { fields: ["name"] } },
      nested: { kind: "object", shape: { fields: ["value"] } },
    },
  };

  test("returns non-record inputs unchanged", () => {
    expect(pruneUnknownFields(null, shape)).toBeNull();
    expect(pruneUnknownFields("value", shape)).toBe("value");
    expect(pruneUnknownFields([1], shape)).toEqual([1]);
  });

  test("copies only known fields into a fresh record", () => {
    const value = { extra: 1, id: "a" };
    const pruned = pruneUnknownFields(value, shape);

    expect(pruned).toEqual({ id: "a" });
    expect(pruned).not.toBe(value);
  });

  test("recurses into object, array, and map fields", () => {
    expect(
      pruneUnknownFields(
        {
          entries: [{ extra: 1, value: 1 }, { value: 2 }],
          id: "a",
          labels: { one: { extra: 1, name: "first" } },
          nested: { extra: 1, value: 3 },
        },
        shape
      )
    ).toEqual({
      entries: [{ value: 1 }, { value: 2 }],
      id: "a",
      labels: { one: { name: "first" } },
      nested: { value: 3 },
    });
  });

  test("returns mistyped nested values as-is for the closed validator", () => {
    expect(
      pruneUnknownFields(
        { entries: "not-an-array", labels: [], nested: "not-a-record" },
        shape
      )
    ).toEqual({ entries: "not-an-array", labels: [], nested: "not-a-record" });
  });
});
