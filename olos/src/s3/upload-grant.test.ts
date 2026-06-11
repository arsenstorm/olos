import { describe, expect, test } from "bun:test";
import { S3Client } from "@aws-sdk/client-s3";
import type { UploadSlot } from "../types/upload-slot";
import {
  createPresignedS3UploadGrant,
  createS3UploadGrant,
} from "./upload-grant";

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
  test("creates an upload grant with an SDK-presigned PUT URL", async () => {
    const grant = await createPresignedS3UploadGrant({
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      now: "2026-01-01T00:00:00.000Z",
      slot,
    });
    const url = new URL(grant.url);

    expect(grant).toMatchObject({
      expiresAt: "2026-01-01T00:00:03.000Z",
      method: "PUT",
      requiredHeaders: {
        "Content-Type": "video/mp4",
        "If-None-Match": "*",
        "x-olos-slot-id": "slot_1",
      },
      slotId: "slot_1",
    });
    expect(url.hostname).toBe("s3.example.com");
    expect(url.pathname).toBe("/media/live/session/v1080/3810.m4s");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-type;host;if-none-match;x-olos-slot-id"
    );
  });

  test("creates an SDK-presigned grant with provider-specific signed headers", async () => {
    const grant = await createPresignedS3UploadGrant({
      additionalHeaders: {
        "x-amz-checksum-sha256": "abc123",
      },
      bucket: "media",
      client: createClient(),
      expiresInSeconds: 3,
      now: "2026-01-01T00:00:00.000Z",
      slot,
    });
    const url = new URL(grant.url);

    expect(grant.requiredHeaders).toMatchObject({
      "Content-Type": "video/mp4",
      "If-None-Match": "*",
      "x-amz-checksum-sha256": "abc123",
      "x-olos-slot-id": "slot_1",
    });
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-type;host;if-none-match;x-amz-checksum-sha256;x-olos-slot-id"
    );
  });

  test("creates an upload grant from an S3 presigned PUT URL", () => {
    expect(
      createS3UploadGrant({
        presignedUrl:
          "https://bucket.s3.example.com/live/session/v1080/3810.m4s?X-Amz-Signature=abc",
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
      url: "https://bucket.s3.example.com/live/session/v1080/3810.m4s?X-Amz-Signature=abc",
    });
  });

  test("creates an upload grant from a path-style S3 presigned PUT URL", () => {
    expect(
      createS3UploadGrant({
        bucket: "media",
        presignedUrl:
          "https://s3.example.com/media/live/session/v1080/3810.m4s?X-Amz-Signature=abc",
        slot,
      }).url
    ).toBe(
      "https://s3.example.com/media/live/session/v1080/3810.m4s?X-Amz-Signature=abc"
    );
  });

  test("rejects presigned URLs for a different object key", () => {
    expect(() =>
      createS3UploadGrant({
        presignedUrl:
          "https://bucket.s3.example.com/live/session/v1080/3811.m4s?X-Amz-Signature=abc",
        slot,
      })
    ).toThrow("presignedUrl path must match uploadSlot.objectKey");
  });

  test("rejects presigned URLs with extra path prefixes", () => {
    expect(() =>
      createS3UploadGrant({
        presignedUrl:
          "https://bucket.s3.example.com/prefix/live/session/v1080/3810.m4s?X-Amz-Signature=abc",
        slot,
      })
    ).toThrow("presignedUrl path must match uploadSlot.objectKey");
  });

  test("supports provider-specific signed headers", () => {
    expect(
      createS3UploadGrant({
        additionalHeaders: {
          "x-amz-checksum-sha256": "abc123",
        },
        expiresAt: "2026-01-01T00:00:03.000Z",
        presignedUrl:
          "https://bucket.s3.example.com/live/session/v1080/3810.m4s?X-Amz-Signature=abc",
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
          "https://bucket.s3.example.com/live/session/v1080/3810.m4s?X-Amz-Signature=abc",
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
          "https://bucket.s3.example.com/live/session/v1080/3810.m4s?X-Amz-Signature=abc",
        slot,
      })
    ).toThrow("additionalHeaders must not override if-none-match");
  });
});

function createClient(): S3Client {
  return new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    endpoint: "https://s3.example.com",
    forcePathStyle: true,
    region: "us-east-1",
  });
}
