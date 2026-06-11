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
