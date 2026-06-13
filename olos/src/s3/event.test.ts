import { describe, expect, test } from "bun:test";
import {
  normalizeS3ObjectCreatedEventRecord,
  normalizeS3ObjectCreatedEvents,
} from "./event";

const record = {
  eventName: "ObjectCreated:Put",
  eventTime: "2026-01-01T00:00:02.000Z",
  responseElements: {
    "x-amz-request-id": "REQ123",
  },
  s3: {
    bucket: {
      name: "media",
    },
    object: {
      eTag: "etag-3810",
      key: "media/v1080/3810.m4s",
      sequencer: "0065A4",
      size: 98_304,
    },
  },
};

describe("s3 event normalization", () => {
  test("normalizes S3 object-created event records", () => {
    expect(
      normalizeS3ObjectCreatedEventRecord({
        contentType: "video/mp4",
        providerId: "s3_primary",
        record,
      })
    ).toEqual({
      event: {
        eventId: "REQ123",
        eventType: "object.created",
        object: {
          contentType: "video/mp4",
          etag: "etag-3810",
          objectKey: "media/v1080/3810.m4s",
          observedAt: "2026-01-01T00:00:02.000Z",
          providerId: "s3_primary",
          size: 98_304,
        },
      },
      status: "object_created",
    });
  });

  test("normalizes S3 object-created event envelopes", () => {
    expect(
      normalizeS3ObjectCreatedEvents({
        payload: { Records: [record] },
        providerId: "s3_primary",
      })
    ).toEqual([
      {
        event: {
          eventId: "REQ123",
          eventType: "object.created",
          object: {
            contentType: "application/octet-stream",
            etag: "etag-3810",
            objectKey: "media/v1080/3810.m4s",
            observedAt: "2026-01-01T00:00:02.000Z",
            providerId: "s3_primary",
            size: 98_304,
          },
        },
        status: "object_created",
      },
    ]);
  });

  test("decodes S3 object keys and falls back to sequencer event ids", () => {
    const result = normalizeS3ObjectCreatedEventRecord({
      providerId: "s3_primary",
      record: {
        ...record,
        responseElements: {},
        s3: {
          object: {
            key: "media/v1080/segment+3810.m4s",
            sequencer: "0065A4",
            size: 98_304,
          },
        },
      },
    });

    expect(result.status).toBe("object_created");

    if (result.status !== "object_created") {
      throw new Error("expected object-created event");
    }

    expect(result.event.eventId).toBe("s3_0065A4");
    expect(result.event.object.objectKey).toBe("media/v1080/segment 3810.m4s");
  });

  test("rejects malformed S3 event envelopes", () => {
    expect(
      normalizeS3ObjectCreatedEvents({ payload: {}, providerId: "s3" })
    ).toEqual([
      {
        error: {
          error: {
            code: "olos.invalid_state",
            message: "s3 event payload must contain Records",
          },
        },
        status: "invalid_event",
      },
    ]);
  });

  test("rejects unsupported or malformed S3 event records", () => {
    expect(
      normalizeS3ObjectCreatedEventRecord({
        providerId: "s3_primary",
        record: { ...record, eventName: "ObjectRemoved:Delete" },
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.invalid_state",
          message: "s3 event record is not object-created",
        },
      },
      status: "invalid_event",
    });

    expect(
      normalizeS3ObjectCreatedEventRecord({
        providerId: "s3_primary",
        record: {
          ...record,
          responseElements: {},
          s3: {
            object: {
              key: "%not-valid",
              size: 98_304,
            },
          },
        },
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.invalid_state",
          message: "s3 object key is invalid",
        },
      },
      status: "invalid_event",
    });

    expect(
      normalizeS3ObjectCreatedEventRecord({
        providerId: "s3_primary",
        record: {
          ...record,
          s3: {
            object: {
              key: "media/session/%2E%2E/secret.m4s",
              sequencer: "0065A4",
              size: 98_304,
            },
          },
        },
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.invalid_state",
          message: "s3 object key is invalid",
        },
      },
      status: "invalid_event",
    });
  });
});
