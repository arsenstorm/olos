import { describe, expect, test } from "bun:test";
import type { S3Client } from "@aws-sdk/client-s3";
import type { UploadSlot } from "../types/upload-slot";
import { invalidStringMapFixture } from "../validation/test-string-map.test-helper";
import { createTestS3Client } from "./test-client.test-helper";
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

const signedOlosMetadataHeaders =
  "content-type;host;if-none-match;x-amz-meta-olos-epoch;x-amz-meta-olos-kind;x-amz-meta-olos-media-sequence-number;x-amz-meta-olos-rendition-id;x-amz-meta-olos-session-id;x-amz-meta-olos-slot-id;x-olos-slot-id";

const requiredOlosS3Headers = {
  "x-amz-meta-olos-epoch": "0",
  "x-amz-meta-olos-kind": "segment",
  "x-amz-meta-olos-media-sequence-number": "3810",
  "x-amz-meta-olos-rendition-id": "v1080",
  "x-amz-meta-olos-session-id": "session_1",
  "x-amz-meta-olos-slot-id": "slot_1",
};

const S3_BUCKET = "media";
const S3_GRANT_NOW = "2026-01-01T00:00:00.000Z";
const S3_GRANT_TTL_SECONDS = 3;

describe("s3 upload grants", () => {
  test("creates an upload grant with an SDK-presigned PUT URL", async () => {
    const grant = await createPresignedS3UploadGrant({
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      now: S3_GRANT_NOW,
      slot,
    });
    const url = new URL(grant.url);

    expect(grant).toMatchObject({
      expiresAt: "2026-01-01T00:00:03.000Z",
      method: "PUT",
      requiredHeaders: {
        "Content-Type": "video/mp4",
        "If-None-Match": "*",
        ...requiredOlosS3Headers,
        "x-olos-slot-id": "slot_1",
      },
      slotId: "slot_1",
    });
    expect(url.hostname).toBe("s3.example.com");
    expect(url.pathname).toBe("/media/live/session/v1080/3810.m4s");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      signedOlosMetadataHeaders
    );
  });

  test("uses injected clock when no now is provided", async () => {
    const grant = await createPresignedS3UploadGrant({
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      clock: () => "2026-01-01T00:00:01.000Z",
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      slot,
    });

    expect(grant.expiresAt).toBe("2026-01-01T00:00:04.000Z");
  });

  test("uses injected now over injected clock", async () => {
    const grant = await createPresignedS3UploadGrant({
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      clock: () => "2026-01-01T00:00:02.000Z",
      now: "2026-01-01T00:00:01.000Z",
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      slot,
    });

    expect(grant.expiresAt).toBe("2026-01-01T00:00:04.000Z");
  });

  test("creates an SDK-presigned grant with provider-specific signed headers", async () => {
    const grant = await createPresignedS3UploadGrant({
      additionalHeaders: {
        "x-amz-checksum-sha256": "abc123",
      },
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: S3_GRANT_TTL_SECONDS,
      now: S3_GRANT_NOW,
      slot,
    });
    const url = new URL(grant.url);

    expect(grant.requiredHeaders).toMatchObject({
      "Content-Type": "video/mp4",
      "If-None-Match": "*",
      "x-amz-checksum-sha256": "abc123",
      ...requiredOlosS3Headers,
      "x-olos-slot-id": "slot_1",
    });
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-type;host;if-none-match;x-amz-checksum-sha256;x-amz-meta-olos-epoch;x-amz-meta-olos-kind;x-amz-meta-olos-media-sequence-number;x-amz-meta-olos-rendition-id;x-amz-meta-olos-session-id;x-amz-meta-olos-slot-id;x-olos-slot-id"
    );
  });

  test("rejects SDK-presigned grants that outlive the slot", async () => {
    await expect(
      createPresignedS3UploadGrant({
        bucket: S3_BUCKET,
        client: createTestS3Client(),
        expiresInSeconds: 6,
        now: S3_GRANT_NOW,
        slot,
      })
    ).rejects.toThrow(
      "uploadGrant.expiresAt must be before or equal to uploadSlot.expiresAt"
    );
  });

  test("allows SDK-presigned grants that expire exactly with the slot", async () => {
    const grant = await createPresignedS3UploadGrant({
      bucket: S3_BUCKET,
      client: createTestS3Client(),
      expiresInSeconds: 5,
      now: S3_GRANT_NOW,
      slot,
    });

    expect(grant.expiresAt).toBe(slot.expiresAt);
  });

  test("validates SDK-presigned slots before signing", async () => {
    await expect(
      createPresignedS3UploadGrant({
        bucket: S3_BUCKET,
        client: null as unknown as S3Client,
        expiresInSeconds: S3_GRANT_TTL_SECONDS,
        now: S3_GRANT_NOW,
        slot: { ...slot, state: "expired" },
      })
    ).rejects.toThrow("uploadSlot.state must be issued");
  });

  test("rejects invalid SDK-presigned grant options", async () => {
    await expect(
      createPresignedS3UploadGrant({
        bucket: "",
        client: createTestS3Client(),
        expiresInSeconds: S3_GRANT_TTL_SECONDS,
        slot,
      })
    ).rejects.toThrow("bucket must be a non-empty string");
    await expect(
      createPresignedS3UploadGrant({
        bucket: "media/live",
        client: createTestS3Client(),
        expiresInSeconds: S3_GRANT_TTL_SECONDS,
        slot,
      })
    ).rejects.toThrow("bucket must not contain path separators");
    await expect(
      createPresignedS3UploadGrant({
        bucket: S3_BUCKET,
        client: createTestS3Client(),
        expiresInSeconds: 0,
        slot,
      })
    ).rejects.toThrow("expiresInSeconds must be a positive number");
    await expect(
      createPresignedS3UploadGrant({
        bucket: S3_BUCKET,
        client: createTestS3Client(),
        expiresInSeconds: S3_GRANT_TTL_SECONDS,
        now: "soon",
        slot,
      })
    ).rejects.toThrow("now must be a valid timestamp");
    await expect(
      createPresignedS3UploadGrant({
        additionalHeaders: invalidStringMapFixture({
          "x-provider-checksum": 123,
        }),
        bucket: S3_BUCKET,
        client: createTestS3Client(),
        expiresInSeconds: S3_GRANT_TTL_SECONDS,
        now: S3_GRANT_NOW,
        slot,
      })
    ).rejects.toThrow("additionalHeaders must be a string map");
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
        ...requiredOlosS3Headers,
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

  test("rejects path-style S3 presigned URLs with a different bucket prefix", () => {
    expect(() =>
      createS3UploadGrant({
        bucket: "media",
        presignedUrl:
          "https://s3.example.com/archive/live/session/v1080/3810.m4s?X-Amz-Signature=abc",
        slot,
      })
    ).toThrow("presignedUrl path must match uploadSlot.objectKey");
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

  test("rejects invalid manual path-style bucket names", () => {
    expect(() =>
      createS3UploadGrant({
        bucket: "",
        presignedUrl:
          "https://s3.example.com/media/live/session/v1080/3810.m4s?X-Amz-Signature=abc",
        slot,
      })
    ).toThrow("bucket must be a non-empty string");

    expect(() =>
      createS3UploadGrant({
        bucket: "media/live",
        presignedUrl:
          "https://s3.example.com/media/live/session/v1080/3810.m4s?X-Amz-Signature=abc",
        slot,
      })
    ).toThrow("bucket must not contain path separators");
  });

  test("rejects invalid manual S3 presigned URLs", () => {
    const urls = [
      "not a url",
      "/live/session/v1080/3810.m4s",
      "s3://bucket/live/session/v1080/3810.m4s",
    ];

    for (const presignedUrl of urls) {
      expect(() =>
        createS3UploadGrant({
          presignedUrl,
          slot,
        })
      ).toThrow("presignedUrl must be an absolute HTTP(S) URL");
    }
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
        ...requiredOlosS3Headers,
        "x-olos-slot-id": "slot_1",
      },
    });
  });

  test("adds part metadata for part upload slots", () => {
    expect(
      createS3UploadGrant({
        presignedUrl:
          "https://bucket.s3.example.com/live/session/v1080/3810.m4s?X-Amz-Signature=abc",
        slot: { ...slot, kind: "part", partNumber: 3 },
      }).requiredHeaders
    ).toMatchObject({
      "x-amz-meta-olos-kind": "part",
      "x-amz-meta-olos-part-number": "3",
    });
  });

  test("omits part metadata for segment upload slots", () => {
    expect(
      createS3UploadGrant({
        presignedUrl:
          "https://bucket.s3.example.com/live/session/v1080/3810.m4s?X-Amz-Signature=abc",
        slot,
      }).requiredHeaders
    ).not.toHaveProperty("x-amz-meta-olos-part-number");
  });

  test("accepts presigned URL fragments when matching slot paths", () => {
    const presignedUrl =
      "https://bucket.s3.example.com/live/session/v1080/3810.m4s?X-Amz-Signature=abc#upload";

    const grant = createS3UploadGrant({
      presignedUrl,
      slot,
    });

    expect(grant.url).toBe(presignedUrl);
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

  test("rejects additional headers that override S3 slot metadata", () => {
    expect(() =>
      createS3UploadGrant({
        additionalHeaders: {
          "x-amz-meta-olos-session-id": "other_session",
        },
        presignedUrl:
          "https://bucket.s3.example.com/live/session/v1080/3810.m4s?X-Amz-Signature=abc",
        slot,
      })
    ).toThrow("additionalHeaders must not override x-amz-meta-olos-session-id");
  });

  test("rejects malformed S3 additional headers", () => {
    expect(() =>
      createS3UploadGrant({
        additionalHeaders: invalidStringMapFixture(null),
        presignedUrl:
          "https://bucket.s3.example.com/live/session/v1080/3810.m4s?X-Amz-Signature=abc",
        slot,
      })
    ).toThrow("additionalHeaders must be a string map");
  });
});
