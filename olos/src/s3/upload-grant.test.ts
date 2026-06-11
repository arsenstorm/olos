import { describe, expect, test } from "bun:test";
import type { UploadSlot } from "../types/upload-slot";
import { createS3UploadGrant } from "./upload-grant";

const slot: UploadSlot = {
  contentType: "video/mp4",
  deliveryUrl: "https://media.example.com/live/session/v1080/3810.m4s",
  duration: 2,
  epoch: 0,
  expiresAt: "2026-01-01T00:00:05.000Z",
  kind: "segment",
  maxBytes: 100_000,
  mediaSequenceNumber: 3810,
  objectKey: "live/session/v1080/3810.m4s",
  publicationMode: "direct-public",
  publisherInstanceId: "pub_1",
  renditionId: "v1080",
  sessionId: "session_1",
  slotId: "slot_1",
  state: "issued",
  tenantId: "tenant_1",
};

describe("s3 upload grants", () => {
  test("creates an upload grant from an S3 presigned PUT URL", () => {
    expect(
      createS3UploadGrant({
        presignedUrl:
          "https://bucket.s3.example.com/live/session/3810.m4s?X-Amz-Signature=abc",
        slot,
      })
    ).toEqual({
      expiresAt: "2026-01-01T00:00:05.000Z",
      method: "PUT",
      requiredHeaders: {
        "Content-Type": "video/mp4",
        "If-None-Match": "*",
        "x-olos-slot-id": "slot_1",
      },
      slotId: "slot_1",
      url: "https://bucket.s3.example.com/live/session/3810.m4s?X-Amz-Signature=abc",
    });
  });

  test("supports provider-specific signed headers", () => {
    expect(
      createS3UploadGrant({
        additionalHeaders: {
          "x-amz-checksum-sha256": "abc123",
        },
        expiresAt: "2026-01-01T00:00:03.000Z",
        presignedUrl:
          "https://bucket.s3.example.com/live/session/3810.m4s?X-Amz-Signature=abc",
        slot,
      })
    ).toMatchObject({
      expiresAt: "2026-01-01T00:00:03.000Z",
      requiredHeaders: {
        "Content-Type": "video/mp4",
        "If-None-Match": "*",
        "x-amz-checksum-sha256": "abc123",
        "x-olos-slot-id": "slot_1",
      },
    });
  });

  test("rejects non-issued slots", () => {
    expect(() =>
      createS3UploadGrant({
        presignedUrl:
          "https://bucket.s3.example.com/live/session/3810.m4s?X-Amz-Signature=abc",
        slot: { ...slot, state: "expired" },
      })
    ).toThrow("uploadSlot.state must be issued");
  });

  test("rejects additional headers that override required OLOS headers", () => {
    expect(() =>
      createS3UploadGrant({
        additionalHeaders: {
          "if-none-match": "etag",
        },
        presignedUrl:
          "https://bucket.s3.example.com/live/session/3810.m4s?X-Amz-Signature=abc",
        slot,
      })
    ).toThrow("additionalHeaders must not override if-none-match");
  });
});
