import { describe, expect, test } from "bun:test";
import type { MediaObject } from "../types/media-object";
import { assertMediaObject, isMediaObject } from "./media-object";

const validMediaObject: MediaObject = {
  contentType: "video/mp4",
  etag: '"abc123"',
  objectKey: "tenant/session/v1080/3810.m4s",
  observedAt: "2026-01-01T00:00:00.000Z",
  providerId: "r2_primary",
  size: 98_304,
};

const invalidMediaObjectCases = [
  {
    error: "mediaObject.providerId must be a non-empty URL-safe identifier",
    label: "unsafe provider IDs",
    value: { ...validMediaObject, providerId: "../r2" },
  },
  {
    error: "mediaObject.objectKey must be a non-empty string",
    label: "missing object keys",
    value: { ...validMediaObject, objectKey: "" },
  },
  {
    error: "mediaObject.objectKey must be a safe relative object key",
    label: "repeated object-key separators",
    value: { ...validMediaObject, objectKey: "tenant//3810.m4s" },
  },
  {
    error: "mediaObject.objectKey must not contain control characters",
    label: "object keys with control characters",
    value: { ...validMediaObject, objectKey: "tenant/3810.m4s\n" },
  },
  {
    error: "mediaObject.contentType must be a valid content type",
    label: "empty content types",
    value: { ...validMediaObject, contentType: "" },
  },
  {
    error: "mediaObject.contentType must be a valid content type",
    label: "malformed content types",
    value: { ...validMediaObject, contentType: "video" },
  },
  {
    error: "mediaObject.contentType must be a valid content type",
    label: "content types with control characters",
    value: {
      ...validMediaObject,
      contentType: "video/mp4\ntext/html",
    },
  },
  {
    error: "mediaObject.observedAt must be a valid timestamp",
    label: "invalid observation timestamps",
    value: { ...validMediaObject, observedAt: "soon" },
  },
  {
    error: "mediaObject.size must be a positive number",
    label: "zero sizes",
    value: { ...validMediaObject, size: 0 },
  },
  {
    error: "mediaObject.size must be a positive number",
    label: "negative sizes",
    value: { ...validMediaObject, size: -1 },
  },
  {
    error: "mediaObject.etag must be a non-empty string",
    label: "non-string etags",
    value: { ...validMediaObject, etag: 123 },
  },
  {
    error: "mediaObject.etag must be a non-empty string",
    label: "empty etags",
    value: { ...validMediaObject, etag: "" },
  },
] as const;

describe("media object validation", () => {
  test("accepts a valid media object", () => {
    expect(isMediaObject(validMediaObject)).toBe(true);
    expect(() => assertMediaObject(validMediaObject)).not.toThrow();
  });

  test("accepts media objects without etags", () => {
    const { etag, ...mediaObject } = validMediaObject;

    expect(etag).toBeDefined();
    expect(() => assertMediaObject(mediaObject)).not.toThrow();
  });

  test("accepts fractional positive sizes", () => {
    expect(() =>
      assertMediaObject({ ...validMediaObject, size: 0.5 })
    ).not.toThrow();
  });

  test("rejects non-object values", () => {
    expect(isMediaObject(null)).toBe(false);
    expect(() => assertMediaObject(null)).toThrow(
      "mediaObject must be an object"
    );
  });

  for (const mediaObjectCase of invalidMediaObjectCases) {
    test(`rejects ${mediaObjectCase.label}`, () => {
      expect(() => assertMediaObject(mediaObjectCase.value)).toThrow(
        mediaObjectCase.error
      );
    });
  }
});
