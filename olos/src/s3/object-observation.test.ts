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
});
