import { describe, expect, test } from "bun:test";
import type { UploadSlot } from "../types/upload-slot";
import { invalidStringMapFixture } from "../validation/test-string-map.test-helper";
import {
  createObservedUpload,
  createObservedUploadFromHeadObject,
  createObservedUploadFromObjectCreatedEvent,
  createUploadCompletionHint,
  normalizeUploadEvent,
  resolveObjectCreatedEventObservation,
  resolveObjectCreatedEventSlot,
  resolveUploadEvidence,
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
        metadata: invalidStringMapFixture({
          checksum: 123,
        }),
        objectKey: "media/session/v1080/3810.m4s",
        observedAt: "2026-01-01T00:00:01.000Z",
        providerId: "s3_primary",
        size: 98_304,
      })
    ).toThrow("observedUpload.metadata must be a string map");

    expect(() =>
      createObservedUpload({
        contentType: "video/mp4",
        metadata: {
          "bad metadata": "slot_1",
        },
        objectKey: "media/session/v1080/3810.m4s",
        observedAt: "2026-01-01T00:00:01.000Z",
        providerId: "s3_primary",
        size: 98_304,
      })
    ).toThrow("observedUpload.metadata must be a string map");
  });
});

describe("head object normalization", () => {
  test("creates an observed upload from a head object response", () => {
    expect(
      createObservedUploadFromHeadObject({
        contentLength: 98_304,
        contentType: "video/mp4",
        etag: '"abc123"',
        lastModified: "2026-01-01T00:00:01.000Z",
        metadata: {
          "x-olos-slot-id": "slot_1",
        },
        objectKey: "media/session/v1080/3810.m4s",
        providerId: "s3_primary",
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

  test("accepts date last-modified values", () => {
    expect(
      createObservedUploadFromHeadObject({
        contentLength: 98_304,
        contentType: "video/mp4",
        lastModified: new Date("2026-01-01T00:00:01.000Z"),
        objectKey: "media/session/v1080/3810.m4s",
        providerId: "s3_primary",
      }).observedAt
    ).toBe("2026-01-01T00:00:01.000Z");
  });

  test("rejects missing content length", () => {
    expect(() =>
      createObservedUploadFromHeadObject({
        contentLength: undefined as unknown as number,
        contentType: "video/mp4",
        lastModified: "2026-01-01T00:00:01.000Z",
        objectKey: "media/session/v1080/3810.m4s",
        providerId: "s3_primary",
      })
    ).toThrow("mediaObject.size must be a positive number");
  });

  test("rejects invalid last-modified values", () => {
    expect(() =>
      createObservedUploadFromHeadObject({
        contentLength: 98_304,
        contentType: "video/mp4",
        lastModified: "not-a-date",
        objectKey: "media/session/v1080/3810.m4s",
        providerId: "s3_primary",
      })
    ).toThrow("mediaObject.observedAt must be a valid timestamp");
  });
});

describe("object created event normalization", () => {
  const slot: UploadSlot = {
    contentType: "video/mp4",
    deliveryUrl: "/objects/media/session/v1080/3810.m4s",
    duration: 2,
    epoch: 0,
    expiresAt: "2026-01-01T00:00:05.000Z",
    kind: "segment",
    maxBytes: 100_000,
    mediaSequenceNumber: 3810,
    objectKey: "media/session/v1080/3810.m4s",
    publicationMode: "direct-public",
    publisherInstanceId: "pub_1",
    renditionId: "v1080",
    sessionId: "session_1",
    slotId: "slot_1",
    state: "issued",
    tenantId: "tenant_1",
  };

  const objectCreatedEvent = createObservedUploadFromObjectCreatedEvent({
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
  });

  const uploadCompletionHint = createUploadCompletionHint({
    eventId: "hint_1",
    eventTime: "2026-01-01T00:00:00.900Z",
    eventType: "upload.completed",
    objectKey: "media/session/v1080/3810.m4s",
    slotId: "slot_1",
  });

  test("creates an observed upload from an object-created event", () => {
    expect(objectCreatedEvent).toEqual({
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

  test("normalizes object-created upload events", () => {
    expect(
      normalizeUploadEvent({
        event: {
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
        },
      })
    ).toEqual({
      event: objectCreatedEvent,
      status: "object_created",
    });
  });

  test("normalizes upload-completed hints", () => {
    expect(
      normalizeUploadEvent({
        event: {
          eventId: "hint_1",
          eventTime: "2026-01-01T00:00:00.900Z",
          eventType: "upload.completed",
          objectKey: "media/session/v1080/3810.m4s",
          slotId: "slot_1",
        },
      })
    ).toEqual({
      hint: uploadCompletionHint,
      status: "upload_completed",
    });
  });

  test("rejects malformed upload event envelopes", () => {
    expect(normalizeUploadEvent({ event: null })).toEqual({
      error: {
        error: {
          code: "olos.invalid_state",
          message: "upload event must be an object",
        },
      },
      status: "invalid_event",
    });
  });

  test("rejects unsupported upload event types", () => {
    expect(
      normalizeUploadEvent({
        event: {
          eventId: "evt_1",
          eventType: "object.deleted",
        },
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.invalid_state",
          message: "upload event type is unsupported",
        },
      },
      status: "invalid_event",
    });
  });

  test("rejects invalid upload event payloads", () => {
    expect(
      normalizeUploadEvent({
        event: {
          contentType: "video/mp4",
          eventId: "not safe",
          eventTime: "2026-01-01T00:00:01.000Z",
          eventType: "object.created",
          objectKey: "media/session/v1080/3810.m4s",
          providerId: "s3_primary",
          size: 98_304,
        },
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.invalid_state",
          message:
            "objectCreatedEvent.eventId must be a non-empty URL-safe identifier",
        },
      },
      status: "invalid_event",
    });

    expect(
      normalizeUploadEvent({
        event: {
          eventId: "hint_1",
          eventTime: "not-a-date",
          eventType: "upload.completed",
          objectKey: "media/session/v1080/3810.m4s",
          slotId: "slot_1",
        },
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.invalid_state",
          message: "uploadCompletionHint.eventTime must be a valid timestamp",
        },
      },
      status: "invalid_event",
    });
  });

  test("matches object-created events to known object keys", () => {
    expect(
      resolveObjectCreatedEventSlot({
        event: objectCreatedEvent,
        slot,
      })
    ).toEqual({
      slot,
      status: "matched",
    });
  });

  test("rejects object-created events for unknown object keys", () => {
    const event = createObservedUploadFromObjectCreatedEvent({
      contentType: "video/mp4",
      eventId: "evt_unknown",
      eventTime: "2026-01-01T00:00:01.000Z",
      eventType: "object.created",
      objectKey: "media/session/v1080/9999.m4s",
      providerId: "s3_primary",
      size: 98_304,
    });

    expect(
      resolveObjectCreatedEventSlot({
        event,
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.unknown_slot",
          details: {
            eventId: "evt_unknown",
            objectKey: "media/session/v1080/9999.m4s",
            providerId: "s3_primary",
          },
          message: "object-created event does not match a known slot",
        },
      },
      status: "unknown_object_key",
    });
  });

  test("rejects object-created events with mismatched slot lookups", () => {
    const event = createObservedUploadFromObjectCreatedEvent({
      contentType: "video/mp4",
      eventId: "evt_mismatch",
      eventTime: "2026-01-01T00:00:01.000Z",
      eventType: "object.created",
      objectKey: "media/session/v1080/9999.m4s",
      providerId: "s3_primary",
      size: 98_304,
    });

    expect(
      resolveObjectCreatedEventSlot({
        event,
        slot,
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.unknown_slot",
          details: {
            eventId: "evt_mismatch",
            objectKey: "media/session/v1080/9999.m4s",
            providerId: "s3_primary",
            slotId: "slot_1",
            slotObjectKey: "media/session/v1080/3810.m4s",
          },
          message: "object-created event does not match a known slot",
        },
      },
      status: "unknown_object_key",
    });
  });

  test("waits for object proof when client hints arrive first", () => {
    expect(resolveUploadEvidence({ hint: uploadCompletionHint })).toEqual({
      hint: uploadCompletionHint,
      status: "awaiting_object",
    });
  });

  test("accepts object proof before client hints arrive", () => {
    expect(
      resolveUploadEvidence({ object: objectCreatedEvent.object })
    ).toEqual({
      object: objectCreatedEvent.object,
      status: "object_observed",
    });
  });

  test("accepts object proof after matching client hints", () => {
    expect(
      resolveUploadEvidence({
        hint: uploadCompletionHint,
        object: objectCreatedEvent.object,
      })
    ).toEqual({
      object: objectCreatedEvent.object,
      status: "object_observed",
    });
  });

  test("matches upload evidence by object key", () => {
    expect(
      resolveUploadEvidence({
        hint: {
          ...uploadCompletionHint,
          slotId: "slot_retry",
        },
        object: objectCreatedEvent.object,
      })
    ).toEqual({
      object: objectCreatedEvent.object,
      status: "object_observed",
    });
  });

  test("rejects conflicting client hints and object proof", () => {
    expect(
      resolveUploadEvidence({
        hint: uploadCompletionHint,
        object: {
          ...objectCreatedEvent.object,
          objectKey: "media/session/v1080/9999.m4s",
        },
      })
    ).toEqual({
      error: {
        error: {
          code: "olos.key_mismatch",
          details: {
            hintEventId: "hint_1",
            hintObjectKey: "media/session/v1080/3810.m4s",
            objectKey: "media/session/v1080/9999.m4s",
            slotId: "slot_1",
          },
          message: "upload hint does not match observed object",
        },
      },
      status: "conflict",
    });
  });

  test("idles without upload evidence", () => {
    expect(resolveUploadEvidence({})).toEqual({ status: "idle" });
  });

  test("observes object-created events once", () => {
    expect(
      resolveObjectCreatedEventObservation({
        event: objectCreatedEvent,
        observedEventIds: [],
      })
    ).toEqual({
      event: objectCreatedEvent,
      status: "observed",
    });
  });

  test("treats duplicate object-created events idempotently", () => {
    expect(
      resolveObjectCreatedEventObservation({
        event: objectCreatedEvent,
        observedEventIds: new Set(["evt_1"]),
      })
    ).toEqual({
      eventId: "evt_1",
      status: "duplicate",
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

  test("rejects invalid client hints", () => {
    expect(() =>
      createUploadCompletionHint(
        null as unknown as Parameters<typeof createUploadCompletionHint>[0]
      )
    ).toThrow("uploadCompletionHint must be an object");

    expect(() =>
      createUploadCompletionHint({
        eventId: "hint_1",
        eventTime: "not-a-date",
        eventType: "upload.completed",
        objectKey: "media/session/v1080/3810.m4s",
        slotId: "slot_1",
      })
    ).toThrow("uploadCompletionHint.eventTime must be a valid timestamp");

    expect(() =>
      createUploadCompletionHint({
        eventId: "hint_1",
        eventTime: "2026-01-01T00:00:00.900Z",
        eventType: "upload.completed",
        objectKey: "media/session/../secret.m4s",
        slotId: "slot_1",
      })
    ).toThrow(
      "uploadCompletionHint.objectKey must be a safe relative object key"
    );
  });
});
