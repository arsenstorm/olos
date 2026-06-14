import { describe, expect, test } from "bun:test";

import type { UploadSlot } from "../types/upload-slot";
import { assertUploadSlot, isUploadSlot } from "./upload-slot";

const validUploadSlot: UploadSlot = {
  contentType: "video/mp4",
  deliveryUrl:
    "https://media.example.com/media/tenant/sess/e1/v1080/s3812/p3.m4s",
  duration: 0.5,
  epoch: 1,
  expiresAt: "2026-06-08T12:00:05Z",
  kind: "part",
  maxBytes: 524_288,
  mediaSequenceNumber: 3812,
  minBytes: 1024,
  objectKey: "media/tenant/sess/e1/v1080/s3812/p3.m4s",
  partNumber: 3,
  publicationMode: "direct-public",
  publisherInstanceId: "pubinst_01",
  renditionId: "v1080",
  sessionId: "sess_01JZLIVE",
  slotId: "slot_01JZ",
  state: "issued",
  tenantId: "tenant_acme",
};

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
      assertUploadSlot({ ...validUploadSlot, mediaSequenceNumber: -1 })
    ).toThrow("uploadSlot.mediaSequenceNumber must be a non-negative integer");
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
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, deliveryUrl: "media/key.m4s" })
    ).toThrow(
      "uploadSlot.deliveryUrl must be an absolute HTTP(S) URL or safe relative path"
    );
    expect(() =>
      assertUploadSlot({
        ...validUploadSlot,
        deliveryUrl: "ftp://media/key.m4s",
      })
    ).toThrow(
      "uploadSlot.deliveryUrl must be an absolute HTTP(S) URL or safe relative path"
    );
    expect(() =>
      assertUploadSlot({
        ...validUploadSlot,
        deliveryUrl: "https://media.example.com/key.m4s?token=abc",
      })
    ).toThrow(
      "uploadSlot.deliveryUrl must not contain query strings or fragments"
    );
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, deliveryUrl: "/media/key.m4s#x" })
    ).toThrow(
      "uploadSlot.deliveryUrl must not contain query strings or fragments"
    );
    expect(() =>
      assertUploadSlot({
        ...validUploadSlot,
        deliveryUrl: "/media/key.m4s\n#EXT-X-ENDLIST",
      })
    ).toThrow("uploadSlot.deliveryUrl must not contain control characters");
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, deliveryUrl: "/media/../key.m4s" })
    ).toThrow(
      "uploadSlot.deliveryUrl must be an absolute HTTP(S) URL or safe relative path"
    );
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, deliveryUrl: "/media//key.m4s" })
    ).toThrow(
      "uploadSlot.deliveryUrl must be an absolute HTTP(S) URL or safe relative path"
    );
  });

  test("rejects unsupported media object extensions", () => {
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, objectKey: "media/key.html" })
    ).toThrow("uploadSlot.objectKey must use a supported media extension");
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, objectKey: "media/playlist.m3u8" })
    ).toThrow("uploadSlot.objectKey must use a supported media extension");
    expect(() =>
      assertUploadSlot({
        ...validUploadSlot,
        kind: "init",
        objectKey: "media/init.m4s",
      })
    ).toThrow("uploadSlot.objectKey must use a supported media extension");
  });

  test("rejects invalid byte limits", () => {
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, minBytes: 20, maxBytes: 10 })
    ).toThrow("uploadSlot.minBytes must be less than or equal to maxBytes");
  });

  test("rejects unknown enum values", () => {
    expect(() =>
      assertUploadSlot({ ...validUploadSlot, state: "unknown" })
    ).toThrow("uploadSlot.state must be one of:");
  });
});
