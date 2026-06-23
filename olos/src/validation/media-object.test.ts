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

  test("rejects unsafe provider IDs", () => {
    expect(() =>
      assertMediaObject({ ...validMediaObject, providerId: "../r2" })
    ).toThrow("mediaObject.providerId must be a non-empty URL-safe identifier");
  });

  test("rejects missing object keys", () => {
    expect(() =>
      assertMediaObject({ ...validMediaObject, objectKey: "" })
    ).toThrow("mediaObject.objectKey must be a non-empty string");
  });

  test("rejects unsafe object keys", () => {
    expect(() =>
      assertMediaObject({ ...validMediaObject, objectKey: "tenant//3810.m4s" })
    ).toThrow("mediaObject.objectKey must be a safe relative object key");
    expect(() =>
      assertMediaObject({
        ...validMediaObject,
        objectKey: "tenant/3810.m4s\n",
      })
    ).toThrow("mediaObject.objectKey must not contain control characters");
  });

  test("rejects missing content types", () => {
    expect(() =>
      assertMediaObject({ ...validMediaObject, contentType: "" })
    ).toThrow("mediaObject.contentType must be a valid content type");
    expect(() =>
      assertMediaObject({ ...validMediaObject, contentType: "video" })
    ).toThrow("mediaObject.contentType must be a valid content type");
    expect(() =>
      assertMediaObject({
        ...validMediaObject,
        contentType: "video/mp4\ntext/html",
      })
    ).toThrow("mediaObject.contentType must be a valid content type");
  });

  test("rejects invalid observation timestamps", () => {
    expect(() =>
      assertMediaObject({ ...validMediaObject, observedAt: "soon" })
    ).toThrow("mediaObject.observedAt must be a valid timestamp");
  });

  test("rejects invalid sizes", () => {
    expect(() => assertMediaObject({ ...validMediaObject, size: 0 })).toThrow(
      "mediaObject.size must be a positive number"
    );
    expect(() => assertMediaObject({ ...validMediaObject, size: -1 })).toThrow(
      "mediaObject.size must be a positive number"
    );
  });

  test("rejects invalid etags", () => {
    expect(() => assertMediaObject({ ...validMediaObject, etag: 123 })).toThrow(
      "mediaObject.etag must be a non-empty string"
    );
    expect(() => assertMediaObject({ ...validMediaObject, etag: "" })).toThrow(
      "mediaObject.etag must be a non-empty string"
    );
  });
});
