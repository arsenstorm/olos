import { describe, expect, test } from "bun:test";
import { assertProviderCanIssueUploadGrant } from "../state/provider-upload-grant-policy";
import type { UploadSlot } from "../types/upload-slot";
import {
  createS3ProviderCapability,
  S3_UPLOAD_GRANT_REQUIRED_HEADERS,
} from "./capability";

const directPublicSlot: UploadSlot = {
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

describe("s3 provider capabilities", () => {
  test("creates an S3-compatible capability document", () => {
    const capability = createS3ProviderCapability({
      providerId: "s3_primary",
      publicBaseUrl: "https://media.example.com",
    });

    expect(capability.api?.family).toBe("s3-compatible");
    expect(capability.uploadGrants.presignedPut).toBe(true);
    expect(capability.publication.directObjectPublication).toBe(true);
  });

  test("satisfies the direct-public upload grant policy", () => {
    const capability = createS3ProviderCapability({
      maxRecommendedTtlSeconds: 30,
      providerId: "s3_primary",
      publicBaseUrl: "https://media.example.com",
    });

    expect(() =>
      assertProviderCanIssueUploadGrant({
        capability,
        grantTtlSeconds: 30,
        slot: directPublicSlot,
      })
    ).not.toThrow();
  });

  test("exports the headers that must be bound into presigned PUTs", () => {
    expect(S3_UPLOAD_GRANT_REQUIRED_HEADERS).toEqual([
      "Content-Type",
      "If-None-Match",
      "x-olos-slot-id",
    ]);
  });
});
