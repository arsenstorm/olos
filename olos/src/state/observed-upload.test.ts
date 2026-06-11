import { describe, expect, test } from "bun:test";
import { createObservedUpload } from "./observed-upload";

describe("observed upload builder", () => {
  test("creates an observed upload from provider metadata", () => {
    expect(
      createObservedUpload({
        contentType: "video/mp4",
        etag: '"abc123"',
        metadata: {
          "x-olos-slot-id": "slot_1",
        },
        objectKey: "media/session/v1080/3810.m4s",
        observedAt: "2026-01-01T00:00:01.000Z",
        providerId: "s3_primary",
        size: 98_304,
      })
    ).toEqual({
      contentType: "video/mp4",
      etag: '"abc123"',
      metadata: {
        "x-olos-slot-id": "slot_1",
      },
      objectKey: "media/session/v1080/3810.m4s",
      observedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      size: 98_304,
    });
  });

  test("allows missing optional etags and metadata", () => {
    expect(
      createObservedUpload({
        contentType: "video/mp4",
        objectKey: "media/session/v1080/3810.m4s",
        observedAt: "2026-01-01T00:00:01.000Z",
        providerId: "s3_primary",
        size: 98_304,
      })
    ).toEqual({
      contentType: "video/mp4",
      objectKey: "media/session/v1080/3810.m4s",
      observedAt: "2026-01-01T00:00:01.000Z",
      providerId: "s3_primary",
      size: 98_304,
    });
  });

  test("rejects invalid object sizes", () => {
    expect(() =>
      createObservedUpload({
        contentType: "video/mp4",
        objectKey: "media/session/v1080/3810.m4s",
        observedAt: "2026-01-01T00:00:01.000Z",
        providerId: "s3_primary",
        size: 0,
      })
    ).toThrow("mediaObject.size must be a positive number");
  });

  test("rejects invalid observation timestamps", () => {
    expect(() =>
      createObservedUpload({
        contentType: "video/mp4",
        objectKey: "media/session/v1080/3810.m4s",
        observedAt: "not-a-date",
        providerId: "s3_primary",
        size: 98_304,
      })
    ).toThrow("mediaObject.observedAt must be a valid timestamp");
  });

  test("rejects invalid metadata", () => {
    expect(() =>
      createObservedUpload({
        contentType: "video/mp4",
        metadata: {
          checksum: 123,
        } as unknown as Record<string, string>,
        objectKey: "media/session/v1080/3810.m4s",
        observedAt: "2026-01-01T00:00:01.000Z",
        providerId: "s3_primary",
        size: 98_304,
      })
    ).toThrow("observedUpload.metadata must be a string map");
  });
});
