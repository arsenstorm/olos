import { describe, expect, test } from "bun:test";
import type {
  HeadObjectCommand,
  HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import {
  createObservedUploadFromS3HeadObject,
  observeS3Object,
  type S3HeadObjectClient,
} from "./object-observation";

describe("s3 object observation", () => {
  test("creates an observed upload from HeadObject output", () => {
    expect(
      createObservedUploadFromS3HeadObject({
        objectKey: "live/session/v1080/3810.m4s",
        observedAt: "2026-01-01T00:00:02.000Z",
        output: {
          $metadata: {},
          ContentLength: 98_304,
          ContentType: "video/mp4",
          ETag: '"etag-3810"',
          Metadata: {
            "x-olos-slot-id": "slot_3810",
          },
        },
        providerId: "s3_primary",
      })
    ).toEqual({
      contentType: "video/mp4",
      etag: '"etag-3810"',
      metadata: {
        "x-olos-slot-id": "slot_3810",
      },
      objectKey: "live/session/v1080/3810.m4s",
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      size: 98_304,
    });
  });

  test("normalizes S3 slot metadata to OLOS metadata", () => {
    expect(
      createObservedUploadFromS3HeadObject({
        objectKey: "live/session/v1080/3810.m4s",
        observedAt: "2026-01-01T00:00:02.000Z",
        output: {
          $metadata: {},
          ContentLength: 98_304,
          ContentType: "video/mp4",
          Metadata: {
            "olos-slot-id": "slot_3810",
          },
        },
        providerId: "s3_primary",
      }).metadata
    ).toEqual({
      "olos-slot-id": "slot_3810",
      "x-olos-slot-id": "slot_3810",
    });
  });

  test("uses LastModified when no observation time is provided", () => {
    expect(
      createObservedUploadFromS3HeadObject({
        objectKey: "live/session/v1080/3810.m4s",
        output: {
          $metadata: {},
          ContentLength: 98_304,
          ContentType: "video/mp4",
          LastModified: new Date("2026-01-01T00:00:01.500Z"),
        },
        providerId: "s3_primary",
      }).observedAt
    ).toBe("2026-01-01T00:00:01.500Z");
  });

  test("uses injected now when no observation time or LastModified are provided", () => {
    expect(
      createObservedUploadFromS3HeadObject({
        objectKey: "live/session/v1080/3810.m4s",
        now: "2026-01-01T00:00:03.000Z",
        output: {
          $metadata: {},
          ContentLength: 98_304,
          ContentType: "video/mp4",
        },
        providerId: "s3_primary",
      }).observedAt
    ).toBe("2026-01-01T00:00:03.000Z");
  });

  test("uses injected clock when no observation time, now, or LastModified are provided", () => {
    expect(
      createObservedUploadFromS3HeadObject({
        objectKey: "live/session/v1080/3810.m4s",
        clock: () => "2026-01-01T00:00:04.000Z",
        output: {
          $metadata: {},
          ContentLength: 98_304,
          ContentType: "video/mp4",
        },
        providerId: "s3_primary",
      }).observedAt
    ).toBe("2026-01-01T00:00:04.000Z");
  });

  test("prefers injected now over injected clock", () => {
    expect(
      createObservedUploadFromS3HeadObject({
        objectKey: "live/session/v1080/3810.m4s",
        clock: () => "2026-01-01T00:00:05.000Z",
        now: "2026-01-01T00:00:04.000Z",
        output: {
          $metadata: {},
          ContentLength: 98_304,
          ContentType: "video/mp4",
        },
        providerId: "s3_primary",
      }).observedAt
    ).toBe("2026-01-01T00:00:04.000Z");
  });

  test("heads the exact S3 object key", async () => {
    const client: S3HeadObjectClient = {
      send(command: HeadObjectCommand): Promise<HeadObjectCommandOutput> {
        expect(command.input).toEqual({
          Bucket: "media",
          Key: "live/session/v1080/3810.m4s",
          VersionId: "version_1",
        });

        return Promise.resolve({
          $metadata: {},
          ContentLength: 98_304,
          ContentType: "video/mp4",
        });
      },
    };

    const object = await observeS3Object({
      bucket: "media",
      client,
      objectKey: "live/session/v1080/3810.m4s",
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
      versionId: "version_1",
    });

    expect(object.objectKey).toBe("live/session/v1080/3810.m4s");
    expect(object.size).toBe(98_304);
  });

  test("rejects invalid S3 object observation options before HeadObject", async () => {
    let sends = 0;
    const client: S3HeadObjectClient = {
      send() {
        sends += 1;

        return Promise.resolve({
          $metadata: {},
          ContentLength: 98_304,
          ContentType: "video/mp4",
        });
      },
    };
    const options = {
      bucket: "media",
      client,
      objectKey: "live/session/v1080/3810.m4s",
      observedAt: "2026-01-01T00:00:02.000Z",
      providerId: "s3_primary",
    };

    await expect(observeS3Object({ ...options, bucket: "" })).rejects.toThrow(
      "bucket must be a non-empty string"
    );
    await expect(
      observeS3Object({ ...options, bucket: "media/live" })
    ).rejects.toThrow("bucket must not contain path separators");
    await expect(
      observeS3Object({
        ...options,
        objectKey: "live/session/../secret.m4s",
      })
    ).rejects.toThrow("objectKey must be a safe relative object key");
    await expect(
      observeS3Object({ ...options, providerId: "../provider" })
    ).rejects.toThrow("providerId must be a non-empty URL-safe identifier");
    await expect(
      observeS3Object({ ...options, observedAt: "soon" })
    ).rejects.toThrow("observedAt must be a valid timestamp");
    expect(sends).toBe(0);
  });

  test("rejects incomplete HeadObject output", () => {
    expect(() =>
      createObservedUploadFromS3HeadObject({
        objectKey: "live/session/v1080/3810.m4s",
        output: {
          $metadata: {},
          ContentType: "video/mp4",
        },
        providerId: "s3_primary",
      })
    ).toThrow("headObject.ContentLength must be present");

    expect(() =>
      createObservedUploadFromS3HeadObject({
        objectKey: "live/session/v1080/3810.m4s",
        output: {
          $metadata: {},
          ContentLength: 98_304,
        },
        providerId: "s3_primary",
      })
    ).toThrow("headObject.ContentType must be present");
  });

  test("rejects invalid HeadObject observation timestamps", () => {
    expect(() =>
      createObservedUploadFromS3HeadObject({
        objectKey: "live/session/v1080/3810.m4s",
        observedAt: "soon",
        output: {
          $metadata: {},
          ContentLength: 98_304,
          ContentType: "video/mp4",
        },
        providerId: "s3_primary",
      })
    ).toThrow("observedAt must be a valid timestamp");
  });
});
