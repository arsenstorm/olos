import { describe, expect, test } from "bun:test";
import {
  createRuntimePublisherNextObjectPlan,
  createRuntimePublisherObjectPlanInput,
  resolveRuntimePublisherNextObjectPosition,
} from "./publisher-cadence";

describe("runtime publisher cadence", () => {
  test("starts with init when it has not been published", () => {
    expect(
      resolveRuntimePublisherNextObjectPosition({
        initPublished: false,
      })
    ).toEqual({
      kind: "init",
      mediaSequenceNumber: 0,
    });
  });

  test("resolves the next segment position", () => {
    expect(
      resolveRuntimePublisherNextObjectPosition({
        cursorWindow: {
          firstMediaSequenceNumber: 3810,
          lastMediaSequenceNumber: 3811,
        },
      })
    ).toEqual({
      kind: "segment",
      mediaSequenceNumber: 3812,
    });
  });

  test("resolves the next low-latency part position", () => {
    expect(
      resolveRuntimePublisherNextObjectPosition({
        cursorWindow: {
          firstMediaSequenceNumber: 3810,
          lastMediaSequenceNumber: 3811,
          lastPartNumber: 1,
        },
        mode: "part",
        partsPerSegment: 4,
      })
    ).toEqual({
      kind: "part",
      mediaSequenceNumber: 3811,
      partNumber: 2,
    });
  });

  test("starts part cadence at the configured media sequence", () => {
    expect(
      resolveRuntimePublisherNextObjectPosition({
        mode: "part",
        partsPerSegment: 4,
        startMediaSequenceNumber: 3810,
      })
    ).toEqual({
      kind: "part",
      mediaSequenceNumber: 3810,
      partNumber: 0,
    });
  });

  test("starts the next segment after the final part", () => {
    expect(
      resolveRuntimePublisherNextObjectPosition({
        cursorWindow: {
          firstMediaSequenceNumber: 3810,
          lastMediaSequenceNumber: 3811,
          lastPartNumber: 3,
        },
        mode: "part",
        partsPerSegment: 4,
      })
    ).toEqual({
      kind: "part",
      mediaSequenceNumber: 3812,
      partNumber: 0,
    });
  });

  test("rejects invalid cadence inputs", () => {
    expect(() =>
      resolveRuntimePublisherNextObjectPosition({
        mode: "part",
      })
    ).toThrow("partsPerSegment must be a positive integer");

    expect(() =>
      resolveRuntimePublisherNextObjectPosition({
        startMediaSequenceNumber: -1,
      })
    ).toThrow("startMediaSequenceNumber must be a non-negative integer");

    expect(() =>
      resolveRuntimePublisherNextObjectPosition({
        cursorWindow: {
          firstMediaSequenceNumber: 3812,
          lastMediaSequenceNumber: 3811,
        },
      })
    ).toThrow(
      "cursorWindow.firstMediaSequenceNumber must be less than or equal to lastMediaSequenceNumber"
    );

    expect(() =>
      resolveRuntimePublisherNextObjectPosition({
        cursorWindow: {
          firstMediaSequenceNumber: 3810,
          lastMediaSequenceNumber: 3811,
          lastPartNumber: -1,
        },
        mode: "part",
        partsPerSegment: 4,
      })
    ).toThrow("cursorWindow.lastPartNumber must be a non-negative integer");
  });

  test("creates plan input from a resolved segment position", () => {
    expect(
      createRuntimePublisherObjectPlanInput({
        baseUrl: "https://media.example.com",
        defaults: objectDefaults,
        objectKeyPrefix: "media/session_1",
        position: {
          kind: "segment",
          mediaSequenceNumber: 3810,
        },
        publicationMode: "direct-public",
        publisherInstanceId: "publisher_1",
        renditionId: "v1080",
      })
    ).toEqual({
      baseUrl: "https://media.example.com",
      contentType: "video/mp4",
      duration: 2,
      extension: "m4s",
      kind: "segment",
      maxBytes: 100_000,
      mediaSequenceNumber: 3810,
      objectKeyPrefix: "media/session_1",
      publicationMode: "direct-public",
      publisherInstanceId: "publisher_1",
      renditionId: "v1080",
    });
  });

  test("creates plan input from a resolved part position", () => {
    expect(
      createRuntimePublisherObjectPlanInput({
        baseUrl: "https://media.example.com",
        defaults: objectDefaults,
        objectKeyPrefix: "media/session_1",
        position: {
          kind: "part",
          mediaSequenceNumber: 3811,
          partNumber: 1,
        },
        publicationMode: "direct-public",
        publisherInstanceId: "publisher_1",
        renditionId: "v1080",
      })
    ).toMatchObject({
      duration: 0.5,
      extension: "m4s",
      kind: "part",
      maxBytes: 25_000,
      mediaSequenceNumber: 3811,
      minBytes: 1,
      partNumber: 1,
    });
  });

  test("passes an object key nonce into the next object plan", () => {
    expect(
      createRuntimePublisherNextObjectPlan({
        baseUrl: "https://media.example.com",
        cursorWindow: {
          firstMediaSequenceNumber: 3810,
          lastMediaSequenceNumber: 3811,
        },
        defaults: objectDefaults,
        now: "2026-01-01T00:00:00.000Z",
        objectKeyNonce: "slot_01JZ",
        objectKeyPrefix: "media/session_1",
        publicationMode: "direct-public",
        publisherInstanceId: "publisher_1",
        renditionId: "v1080",
        targetLatency: 3,
      }).plan.slot.objectKey
    ).toBe("media/session_1/v1080/s3812/segment-slot_01JZ.m4s");
  });

  test("creates the next object plan from cursor cadence", () => {
    expect(
      createRuntimePublisherNextObjectPlan({
        baseUrl: "https://media.example.com",
        cursorWindow: {
          firstMediaSequenceNumber: 3810,
          lastMediaSequenceNumber: 3811,
        },
        defaults: objectDefaults,
        now: "2026-01-01T00:00:00.000Z",
        objectKeyNonce: "slot_01JZ",
        objectKeyPrefix: "media/session_1",
        publicationMode: "direct-public",
        publisherInstanceId: "publisher_1",
        renditionId: "v1080",
        targetLatency: 3,
      })
    ).toEqual({
      expiry: {
        expiresAt: "2026-01-01T00:00:05.000Z",
        ttlSeconds: 5,
      },
      plan: {
        commitId: "commit_v1080_s3812",
        slot: {
          contentType: "video/mp4",
          deliveryUrl:
            "https://media.example.com/media/session_1/v1080/s3812/segment-slot_01JZ.m4s",
          duration: 2,
          expiresAt: "2026-01-01T00:00:05.000Z",
          kind: "segment",
          maxBytes: 100_000,
          mediaSequenceNumber: 3812,
          objectKey: "media/session_1/v1080/s3812/segment-slot_01JZ.m4s",
          publicationMode: "direct-public",
          publisherInstanceId: "publisher_1",
          renditionId: "v1080",
          slotId: "slot_v1080_s3812",
        },
      },
      position: {
        kind: "segment",
        mediaSequenceNumber: 3812,
      },
    });
  });

  test("creates the next low-latency part plan", () => {
    expect(
      createRuntimePublisherNextObjectPlan({
        baseUrl: "https://media.example.com",
        cursorWindow: {
          firstMediaSequenceNumber: 3810,
          lastMediaSequenceNumber: 3811,
          lastPartNumber: 0,
        },
        defaults: objectDefaults,
        mode: "part",
        now: "2026-01-01T00:00:00.000Z",
        objectKeyNonce: "slot_01K0",
        objectKeyPrefix: "media/session_1",
        partsPerSegment: 4,
        publicationMode: "direct-public",
        publisherInstanceId: "publisher_1",
        renditionId: "v1080",
        targetLatency: 3,
      })
    ).toMatchObject({
      expiry: {
        expiresAt: "2026-01-01T00:00:04.000Z",
        ttlSeconds: 4,
      },
      plan: {
        commitId: "commit_v1080_s3811_p1",
        slot: {
          kind: "part",
          objectKey: "media/session_1/v1080/s3811/p1-slot_01K0.m4s",
          partNumber: 1,
        },
      },
      position: {
        kind: "part",
        mediaSequenceNumber: 3811,
        partNumber: 1,
      },
    });
  });
});

const objectDefaults = {
  init: {
    contentType: "video/mp4",
    duration: 1,
    extension: "mp4",
    maxBytes: 2048,
  },
  part: {
    contentType: "video/mp4",
    duration: 0.5,
    extension: "m4s",
    maxBytes: 25_000,
    minBytes: 1,
  },
  segment: {
    contentType: "video/mp4",
    duration: 2,
    extension: "m4s",
    maxBytes: 100_000,
  },
} as const;
