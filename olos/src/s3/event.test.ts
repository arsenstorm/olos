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
      key: "media/v1080/s3810.m4s",
      sequencer: "0065A4",
      size: 98_304,
    },
  },
};

const malformedS3EventRecordCases = [
  {
    message: "s3 event record is invalid",
    record: { ...record, s3: { bucket: { name: "media" } } },
  },
  {
    message: "s3 event record is not object-created",
    record: { ...record, eventName: "ObjectRemoved:Delete" },
  },
  {
    message: "s3 event bucket is invalid",
    record: {
      ...record,
      s3: {
        bucket: {
          name: "media/live",
        },
        object: {
          key: "media/v1080/s3810.m4s",
          sequencer: "0065A4",
          size: 98_304,
        },
      },
    },
  },
  {
    message: "s3 object key is invalid",
    record: {
      ...record,
      responseElements: {},
      s3: {
        bucket: {
          name: "media",
        },
        object: {
          key: "%not-valid",
          size: 98_304,
        },
      },
    },
  },
  {
    message: "s3 object key is invalid",
    record: {
      ...record,
      s3: {
        bucket: {
          name: "media",
        },
        object: {
          key: "media/session/%2E%2E/secret.m4s",
          sequencer: "0065A4",
          size: 98_304,
        },
      },
    },
  },
  {
    message: "s3 event record must include a request id or sequencer",
    record: {
      ...record,
      responseElements: {},
      s3: {
        bucket: {
          name: "media",
        },
        object: {
          key: "media/v1080/s3810.m4s",
          size: 98_304,
        },
      },
    },
  },
] as const;

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
          objectKey: "media/v1080/s3810.m4s",
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
        expectedBucket: "media",
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
            objectKey: "media/v1080/s3810.m4s",
            observedAt: "2026-01-01T00:00:02.000Z",
            providerId: "s3_primary",
            size: 98_304,
          },
        },
        status: "object_created",
      },
    ]);
  });

  test("rejects S3 events from unexpected buckets", () => {
    expect(
      normalizeS3ObjectCreatedEventRecord({
        expectedBucket: "media/live",
        providerId: "s3_primary",
        record,
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.invalid_state",
          message: "expectedBucket is invalid",
        },
      },
      status: "invalid_event",
    });

    expect(
      normalizeS3ObjectCreatedEventRecord({
        expectedBucket: "media",
        providerId: "s3_primary",
        record: {
          ...record,
          s3: {
            bucket: {
              name: "archive",
            },
            object: {
              key: "media/v1080/s3810.m4s",
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
          message: "s3 event bucket does not match expected bucket",
        },
      },
      status: "invalid_event",
    });
  });

  test("decodes S3 object keys and falls back to sequencer event ids", () => {
    const result = normalizeS3ObjectCreatedEventRecord({
      providerId: "s3_primary",
      record: {
        ...record,
        responseElements: {},
        s3: {
          bucket: {
            name: "media",
          },
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
    expect(
      normalizeS3ObjectCreatedEvents({
        payload: { Records: {} },
        providerId: "s3",
      })
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

  test("returns one invalid result per record when envelope options are invalid", () => {
    expect(
      normalizeS3ObjectCreatedEvents({
        payload: { Records: [record, record] },
        providerId: "../provider",
      })
    ).toEqual([
      {
        error: {
          error: {
            code: "olos.invalid_state",
            message: "providerId must be a non-empty URL-safe identifier",
          },
        },
        status: "invalid_event",
      },
      {
        error: {
          error: {
            code: "olos.invalid_state",
            message: "providerId must be a non-empty URL-safe identifier",
          },
        },
        status: "invalid_event",
      },
    ]);
  });

  test("rejects unsupported or malformed S3 event records", () => {
    for (const testCase of malformedS3EventRecordCases) {
      expect(
        normalizeS3ObjectCreatedEventRecord({
          providerId: "s3_primary",
          record: testCase.record,
        })
      ).toEqual(invalidS3Event(testCase.message));
    }
  });
});

function invalidS3Event(message: string) {
  return {
    error: {
      error: {
        code: "olos.invalid_state" as const,
        message,
      },
    },
    status: "invalid_event" as const,
  };
}
