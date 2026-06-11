import { describe, expect, test } from "bun:test";
import {
  createObservedUpload,
  createObservedUploadFromObjectCreatedEvent,
} from "./observed-upload";

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

describe("object created event normalization", () => {
  test("creates an observed upload from an object-created event", () => {
    expect(
      createObservedUploadFromObjectCreatedEvent({
        contentType: "video/mp4",
        etag: '"abc123"',
        eventId: "evt_1",
        eventTime: "2026-01-01T00:00:01.000Z",
        eventType: "object.created",
        metadata: {
          "x-olos-slot-id": "slot_1",
        },
        objectKey: "media/session/v1080/3810.m4s",
        providerId: "s3_primary",
        size: 98_304,
      })
    ).toEqual({
      eventId: "evt_1",
      eventType: "object.created",
      object: {
        contentType: "video/mp4",
        etag: '"abc123"',
        metadata: {
          "x-olos-slot-id": "slot_1",
        },
        objectKey: "media/session/v1080/3810.m4s",
        observedAt: "2026-01-01T00:00:01.000Z",
        providerId: "s3_primary",
        size: 98_304,
      },
    });
  });

  test("rejects invalid event ids", () => {
    expect(() =>
      createObservedUploadFromObjectCreatedEvent({
        contentType: "video/mp4",
        eventId: "not safe",
        eventTime: "2026-01-01T00:00:01.000Z",
        eventType: "object.created",
        objectKey: "media/session/v1080/3810.m4s",
        providerId: "s3_primary",
        size: 98_304,
      })
    ).toThrow(
      "objectCreatedEvent.eventId must be a non-empty URL-safe identifier"
    );
  });

  test("rejects unsupported event types", () => {
    expect(() =>
      createObservedUploadFromObjectCreatedEvent({
        contentType: "video/mp4",
        eventId: "evt_1",
        eventTime: "2026-01-01T00:00:01.000Z",
        eventType: "object.deleted" as "object.created",
        objectKey: "media/session/v1080/3810.m4s",
        providerId: "s3_primary",
        size: 98_304,
      })
    ).toThrow("objectCreatedEvent.eventType must be object.created");
  });

  test("rejects invalid event times", () => {
    expect(() =>
      createObservedUploadFromObjectCreatedEvent({
        contentType: "video/mp4",
        eventId: "evt_1",
        eventTime: "not-a-date",
        eventType: "object.created",
        objectKey: "media/session/v1080/3810.m4s",
        providerId: "s3_primary",
        size: 98_304,
      })
    ).toThrow("mediaObject.observedAt must be a valid timestamp");
  });
});
