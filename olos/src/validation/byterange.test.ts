import { describe, expect, test } from "bun:test";

import { assertByterange, assertByterangeKind, isByterange } from "./byterange";

const validByterange = {
  length: 12_500,
  offset: 0,
  segmentDeliveryUrl:
    "https://media.example.com/live/sess_01/v1080/segment-0.m4s",
  segmentObjectKey: "live/sess_01/v1080/segment-0.m4s",
} as const;

describe("Byterange validation", () => {
  test("accepts a valid byterange", () => {
    expect(() => assertByterange(validByterange, "byterange")).not.toThrow();
    expect(isByterange(validByterange)).toBe(true);
  });

  test("rejects negative offset", () => {
    expect(() =>
      assertByterange({ ...validByterange, offset: -1 }, "byterange")
    ).toThrow();
  });

  test("rejects zero or negative length", () => {
    expect(() =>
      assertByterange({ ...validByterange, length: 0 }, "byterange")
    ).toThrow();
    expect(() =>
      assertByterange({ ...validByterange, length: -100 }, "byterange")
    ).toThrow();
  });

  test("rejects non-integer offset and length", () => {
    expect(() =>
      assertByterange({ ...validByterange, offset: 1.5 }, "byterange")
    ).toThrow();
    expect(() =>
      assertByterange({ ...validByterange, length: 1.5 }, "byterange")
    ).toThrow();
  });

  test("rejects unsafe segmentObjectKey", () => {
    expect(() =>
      assertByterange(
        { ...validByterange, segmentObjectKey: "../escape" },
        "byterange"
      )
    ).toThrow();
  });

  test("rejects unsafe segmentDeliveryUrl", () => {
    expect(() =>
      assertByterange(
        {
          ...validByterange,
          segmentDeliveryUrl: "javascript:alert(1)",
        },
        "byterange"
      )
    ).toThrow();
  });

  test("rejects non-object input", () => {
    expect(() => assertByterange(null, "byterange")).toThrow();
    expect(() => assertByterange("not an object", "byterange")).toThrow();
    expect(() => assertByterange(undefined, "byterange")).toThrow();
  });

  test("assertByterangeKind only permits 'part'", () => {
    expect(() => assertByterangeKind("part", "uploadSlot")).not.toThrow();
    expect(() => assertByterangeKind("segment", "uploadSlot")).toThrow(
      'uploadSlot.byterange may only be set when kind is "part"'
    );
    expect(() => assertByterangeKind("init", "uploadSlot")).toThrow();
  });
});
