import { describe, expect, test } from "bun:test";
import type { UploadGrant } from "../types/upload-grant";
import { assertUploadGrant, isUploadGrant } from "./upload-grant";

const validUploadGrant: UploadGrant = {
  expiresAt: "2026-06-08T12:00:05.000Z",
  method: "PUT",
  requiredHeaders: {
    "content-type": "video/iso.segment",
    "x-upload-token": "token_1",
  },
  slotId: "slot_1",
  url: "https://media.example.com/upload/slot_1",
};

describe("upload grant validation", () => {
  test("accepts a valid upload grant", () => {
    expect(() => assertUploadGrant(validUploadGrant)).not.toThrow();
    expect(isUploadGrant(validUploadGrant)).toBe(true);
  });

  test("accepts upload grant URLs with query strings and fragments", () => {
    const uploadGrant = {
      ...validUploadGrant,
      url: "https://upload.example.com/session/slot?signature=abc#part",
    };

    expect(() => assertUploadGrant(uploadGrant)).not.toThrow();
    expect(isUploadGrant(uploadGrant)).toBe(true);
  });

  test("accepts grants without required headers", () => {
    const { requiredHeaders, ...grant } = validUploadGrant;

    expect(() => assertUploadGrant(grant)).not.toThrow();
  });

  test("accepts HTTP upload URLs", () => {
    expect(() =>
      assertUploadGrant({
        ...validUploadGrant,
        url: "http://localhost:8080/upload/slot_1",
      })
    ).not.toThrow();
  });

  test("rejects non-object values", () => {
    expect(() => assertUploadGrant(null)).toThrow(
      "uploadGrant must be an object"
    );
    expect(isUploadGrant(null)).toBe(false);
  });

  test("rejects unsafe slot IDs", () => {
    expect(() =>
      assertUploadGrant({ ...validUploadGrant, slotId: "../slot" })
    ).toThrow("uploadGrant.slotId must be a non-empty URL-safe identifier");
  });

  test("rejects non-PUT methods", () => {
    expect(() =>
      assertUploadGrant({ ...validUploadGrant, method: "POST" })
    ).toThrow("uploadGrant.method must be PUT");
    expect(() =>
      assertUploadGrant({ ...validUploadGrant, method: undefined })
    ).toThrow("uploadGrant.method must be PUT");
  });

  test("rejects invalid upload URLs", () => {
    expect(() => assertUploadGrant({ ...validUploadGrant, url: "" })).toThrow(
      "uploadGrant.url must be an absolute HTTP(S) URL"
    );

    expect(() =>
      assertUploadGrant({ ...validUploadGrant, url: "/upload/slot_1" })
    ).toThrow("uploadGrant.url must be an absolute HTTP(S) URL");

    expect(() =>
      assertUploadGrant({
        ...validUploadGrant,
        url: "ftp://media.example.com/upload/slot_1",
      })
    ).toThrow("uploadGrant.url must be an absolute HTTP(S) URL");
  });

  test("rejects invalid expiry timestamps", () => {
    expect(() =>
      assertUploadGrant({ ...validUploadGrant, expiresAt: "not-a-date" })
    ).toThrow("uploadGrant.expiresAt must be a valid timestamp");
  });

  test("rejects invalid required headers", () => {
    expect(() =>
      assertUploadGrant({ ...validUploadGrant, requiredHeaders: [] })
    ).toThrow("uploadGrant.requiredHeaders must be a string map");

    expect(() =>
      assertUploadGrant({
        ...validUploadGrant,
        requiredHeaders: { "content-type": 42 },
      })
    ).toThrow("uploadGrant.requiredHeaders must be a string map");

    expect(() =>
      assertUploadGrant({
        ...validUploadGrant,
        requiredHeaders: { "": "video/iso.segment" },
      })
    ).toThrow("uploadGrant.requiredHeaders must be a string map");

    expect(() =>
      assertUploadGrant({
        ...validUploadGrant,
        requiredHeaders: { "bad header": "video/iso.segment" },
      })
    ).toThrow("uploadGrant.requiredHeaders must be a string map");
  });
});
