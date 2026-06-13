import { describe, expect, test } from "bun:test";
import { createRuntimePublisherObjectPlan } from "./publisher-plan";

describe("runtime publisher object plan", () => {
  test("creates a segment slot payload and commit id", () => {
    const plan = createRuntimePublisherObjectPlan({
      baseUrl: "https://media.example.com",
      contentType: "video/iso.segment",
      duration: 2,
      expiresAt: "2026-01-01T00:00:05.000Z",
      extension: "m4s",
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKeyPrefix: "media/session_1",
      publicationMode: "direct-public",
      publisherInstanceId: "publisher_1",
      renditionId: "v1080",
    });

    expect(plan).toEqual({
      commitId: "commit_v1080_s3810",
      slot: {
        contentType: "video/iso.segment",
        deliveryUrl:
          "https://media.example.com/media/session_1/v1080/s3810.m4s",
        duration: 2,
        expiresAt: "2026-01-01T00:00:05.000Z",
        kind: "segment",
        maxBytes: 100_000,
        mediaSequenceNumber: 3810,
        objectKey: "media/session_1/v1080/s3810.m4s",
        publicationMode: "direct-public",
        publisherInstanceId: "publisher_1",
        renditionId: "v1080",
        slotId: "slot_v1080_s3810",
      },
    });
  });

  test("creates a part slot payload", () => {
    const plan = createRuntimePublisherObjectPlan({
      baseUrl: "https://media.example.com/live/",
      contentType: "video/iso.segment",
      duration: 0.5,
      expiresAt: "2026-01-01T00:00:05.000Z",
      extension: "m4s",
      kind: "part",
      maxBytes: 25_000,
      mediaSequenceNumber: 3810,
      objectKeyPrefix: "media/session_1",
      partNumber: 2,
      publicationMode: "direct-public",
      publisherInstanceId: "publisher_1",
      renditionId: "v1080",
      slotIdPrefix: "upload",
    });

    expect(plan.commitId).toBe("commit_v1080_s3810_p2");
    expect(plan.slot).toMatchObject({
      deliveryUrl:
        "https://media.example.com/live/media/session_1/v1080/s3810/p2.m4s",
      kind: "part",
      objectKey: "media/session_1/v1080/s3810/p2.m4s",
      partNumber: 2,
      slotId: "upload_v1080_s3810_p2",
    });
  });

  test("creates nonce-bearing object keys for direct-public publication", () => {
    const init = createRuntimePublisherObjectPlan({
      ...validSegmentPlan(),
      extension: "mp4",
      kind: "init",
      mediaSequenceNumber: 0,
      objectKeyNonce: "slot_01JZ",
    });
    const segment = createRuntimePublisherObjectPlan({
      ...validSegmentPlan(),
      objectKeyNonce: "slot_01K0",
    });
    const part = createRuntimePublisherObjectPlan({
      ...validSegmentPlan(),
      kind: "part",
      objectKeyNonce: "slot_01K1",
      partNumber: 2,
    });

    expect(init.slot.objectKey).toBe(
      "media/session_1/v1080/init-slot_01JZ.mp4"
    );
    expect(init.slot.deliveryUrl).toBe(
      "https://media.example.com/media/session_1/v1080/init-slot_01JZ.mp4"
    );
    expect(segment.slot.objectKey).toBe(
      "media/session_1/v1080/s3810/segment-slot_01K0.m4s"
    );
    expect(part.slot.objectKey).toBe(
      "media/session_1/v1080/s3810/p2-slot_01K1.m4s"
    );
  });

  test("creates an init slot payload", () => {
    const plan = createRuntimePublisherObjectPlan({
      baseUrl: "https://media.example.com",
      contentType: "video/mp4",
      duration: 1,
      expiresAt: "2026-01-01T00:00:05.000Z",
      extension: "mp4",
      kind: "init",
      maxBytes: 2048,
      mediaSequenceNumber: 0,
      objectKeyPrefix: "media/session_1",
      publicationMode: "direct-public",
      publisherInstanceId: "publisher_1",
      renditionId: "v1080",
    });

    expect(plan.commitId).toBe("commit_init_v1080");
    expect(plan.slot.objectKey).toBe("media/session_1/v1080/init.mp4");
    expect(plan.slot.slotId).toBe("slot_init_v1080");
  });

  test("rejects unsafe plans", () => {
    expect(() =>
      createRuntimePublisherObjectPlan({
        ...validSegmentPlan(),
        kind: "part",
      })
    ).toThrow("partNumber must be a non-negative integer for parts");

    expect(() =>
      createRuntimePublisherObjectPlan({
        ...validSegmentPlan(),
        objectKeyPrefix: "../media",
      })
    ).toThrow("objectKeyPrefix must be a safe relative path");

    expect(() =>
      createRuntimePublisherObjectPlan({
        ...validSegmentPlan(),
        objectKeyPrefix: "media/session_1?token=abc",
      })
    ).toThrow("objectKeyPrefix must not contain query strings or fragments");

    expect(() =>
      createRuntimePublisherObjectPlan({
        ...validSegmentPlan(),
        objectKeyPrefix: "media/session_1#live",
      })
    ).toThrow("objectKeyPrefix must not contain query strings or fragments");

    expect(() =>
      createRuntimePublisherObjectPlan({
        ...validSegmentPlan(),
        baseUrl: "ftp://media.example.com",
      })
    ).toThrow("baseUrl must be an absolute HTTP(S) URL");

    expect(() =>
      createRuntimePublisherObjectPlan({
        ...validSegmentPlan(),
        baseUrl: "not a url",
      })
    ).toThrow("baseUrl must be an absolute HTTP(S) URL");

    expect(() =>
      createRuntimePublisherObjectPlan({
        ...validSegmentPlan(),
        objectKeyNonce: "../slot",
      })
    ).toThrow("objectKeyNonce must be a non-empty URL-safe identifier");

    expect(() =>
      createRuntimePublisherObjectPlan({
        ...validSegmentPlan(),
        extension: "html",
      })
    ).toThrow("extension must use a supported media extension");

    expect(() =>
      createRuntimePublisherObjectPlan({
        ...validSegmentPlan(),
        expiresAt: "soon",
      })
    ).toThrow("expiresAt must be a valid timestamp");

    expect(() =>
      createRuntimePublisherObjectPlan({
        ...validSegmentPlan(),
        publicationMode: "unknown" as "direct-public",
      })
    ).toThrow(
      "publicationMode must be one of: direct-public, read-gated, private-upload-public-promotion"
    );
  });
});

function validSegmentPlan() {
  return {
    baseUrl: "https://media.example.com",
    contentType: "video/iso.segment",
    duration: 2,
    expiresAt: "2026-01-01T00:00:05.000Z",
    extension: "m4s",
    kind: "segment" as const,
    maxBytes: 100_000,
    mediaSequenceNumber: 3810,
    objectKeyPrefix: "media/session_1",
    publicationMode: "direct-public" as const,
    publisherInstanceId: "publisher_1",
    renditionId: "v1080",
  };
}
