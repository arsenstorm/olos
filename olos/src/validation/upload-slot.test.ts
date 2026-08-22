import { describe, expect, test } from "bun:test";

import type { UploadSlot } from "../types/upload-slot";
import { assertUploadSlot, isUploadSlot, parseUploadSlot } from "./upload-slot";

const validUploadSlot: UploadSlot = {
  contentType: "video/mp4",
  deliveryUrl:
    "https://media.example.com/media/tenant/sess/e1/v1080/s3812/p3.m4s",
  profile: { duration: 0.5 },
  epoch: 1,
  expiresAt: "2026-06-08T12:00:05Z",
  kind: "part",
  maxBytes: 524_288,
  sequenceNumber: 3812,
  minBytes: 1024,
  objectKey: "media/tenant/sess/e1/v1080/s3812/p3.m4s",
  partNumber: 3,
  trackId: "v1080",
  sessionId: "sess_01JZLIVE",
  slotId: "slot_01JZ",
  state: "issued",
};

const unsafeDeliveryUrlCases = [
  {
    error:
      "uploadSlot.deliveryUrl must be an absolute HTTP(S) URL or safe relative path",
    label: "relative paths without a leading slash",
    value: "media/key.m4s",
  },
  {
    error:
      "uploadSlot.deliveryUrl must be an absolute HTTP(S) URL or safe relative path",
    label: "non-HTTP schemes",
    value: "ftp://media/key.m4s",
  },
  {
    error: "uploadSlot.deliveryUrl must not contain query strings or fragments",
    label: "absolute URL query strings",
    value: "https://media.example.com/key.m4s?token=abc",
  },
  {
    error: "uploadSlot.deliveryUrl must not contain query strings or fragments",
    label: "relative path fragments",
    value: "/media/key.m4s#x",
  },
  {
    error: "uploadSlot.deliveryUrl must not contain control characters",
    label: "control characters",
    value: "/media/key.m4s\n#EXT-X-ENDLIST",
  },
  {
    error:
      "uploadSlot.deliveryUrl must be an absolute HTTP(S) URL or safe relative path",
    label: "parent directory segments",
    value: "/media/../key.m4s",
  },
  {
    error:
      "uploadSlot.deliveryUrl must be an absolute HTTP(S) URL or safe relative path",
    label: "repeated slashes",
    value: "/media//key.m4s",
  },
] as const;

describe("upload slot validation", () => {
  test("accepts a valid upload slot", () => {
    expect(isUploadSlot(validUploadSlot)).toBe(true);
    expect(() => assertUploadSlot(validUploadSlot)).not.toThrow();
  });

  test("rejects non-object values", () => {
    expect(isUploadSlot(null)).toBe(false);
    expect(() => assertUploadSlot(null)).toThrow(
      "uploadSlot must be an object"
    );
  });

  test("rejects unsafe identifiers", () => {
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, slotId: "../secret" })
    ).toThrow("uploadSlot.slotId must be a non-empty URL-safe identifier");
  });

  test("rejects invalid sequence numbers", () => {
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, sequenceNumber: -1 })
    ).toThrow("uploadSlot.sequenceNumber must be a non-negative integer");
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, partNumber: -1 })
    ).toThrow("uploadSlot.partNumber must be a non-negative integer");
  });

  test("rejects invalid expiry timestamps", () => {
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, expiresAt: "soon" })
    ).toThrow("uploadSlot.expiresAt must be a valid timestamp");
  });

  test("rejects unsafe object keys", () => {
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, objectKey: "/media/key.m4s" })
    ).toThrow("uploadSlot.objectKey must be a safe relative object key");
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, objectKey: "media/key.m4s\n" })
    ).toThrow("uploadSlot.objectKey must not contain control characters");
  });

  test("rejects unsafe delivery URLs", () => {
    for (const deliveryUrl of unsafeDeliveryUrlCases) {
      expect(() =>
        assertUploadSlot({
          ...validUploadSlot,
          deliveryUrl: deliveryUrl.value,
        })
      ).toThrow(deliveryUrl.error);
    }
  });

  test("accepts object keys with any extension", () => {
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, objectKey: "media/key.json" })
    ).not.toThrow();
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, objectKey: "media/key" })
    ).not.toThrow();
  });

  test("rejects non-object profiles", () => {
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, profile: 0.5 })
    ).toThrow("uploadSlot.profile must be an object");
  });

  test("rejects invalid content types", () => {
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, contentType: "" })
    ).toThrow("uploadSlot.contentType must be a valid content type");
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, contentType: "video" })
    ).toThrow("uploadSlot.contentType must be a valid content type");
  });

  test("rejects invalid byte limits", () => {
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, minBytes: 20, maxBytes: 10 })
    ).toThrow("uploadSlot.minBytes must be less than or equal to maxBytes");
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, maxBytes: 1024.5 })
    ).toThrow("uploadSlot.maxBytes must be a positive integer");
    expect(() => assertUploadSlot({ ...validUploadSlot, maxBytes: 0 })).toThrow(
      "uploadSlot.maxBytes must be a positive integer"
    );
  });

  test("accepts zero minimum byte limits", () => {
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, minBytes: 0 })
    ).not.toThrow();
  });

  test("accepts upload slots without minimum byte limits", () => {
    const { minBytes: _minBytes, ...slotWithoutMinBytes } = validUploadSlot;

    expect(() => assertUploadSlot(slotWithoutMinBytes)).not.toThrow();
  });

  test("rejects unknown enum values", () => {
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, state: "unknown" })
    ).toThrow("uploadSlot.state must be one of:");
  });

  test("requires partNumber on part slots", () => {
    const { partNumber: _partNumber, ...slotWithoutPartNumber } =
      validUploadSlot;

    expect(() => assertUploadSlot(slotWithoutPartNumber)).toThrow(
      "uploadSlot.partNumber is required for part slots"
    );
  });

  test("rejects partNumber on non-part slots", () => {
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, kind: "segment" })
    ).toThrow("uploadSlot.partNumber is only valid on part slots");
  });
});

describe("tolerant upload slot parsing", () => {
  test("strips unknown fields and returns a fresh slot", () => {
    const parsed = parseUploadSlot({ ...validUploadSlot, extra: 1 });

    expect(parsed).toEqual(validUploadSlot);
    expect(parsed).not.toBe(validUploadSlot);
  });

  test("strips unknown fields inside the byterange", () => {
    const slotWithByterange: UploadSlot = {
      ...validUploadSlot,
      byterange: {
        length: 12_500,
        offset: 0,
        segmentDeliveryUrl:
          "https://media.example.com/media/tenant/sess/e1/v1080/s3812.m4s",
        segmentObjectKey: "media/tenant/sess/e1/v1080/s3812.m4s",
      },
    };

    const parsed = parseUploadSlot({
      ...slotWithByterange,
      byterange: { ...slotWithByterange.byterange, extra: 1 },
    });

    expect(parsed).toEqual(slotWithByterange);
  });

  test("still rejects invalid known fields", () => {
    expect(() =>
      parseUploadSlot({ ...validUploadSlot, extra: 1, maxBytes: 0 })
    ).toThrow("uploadSlot.maxBytes");
  });
});
