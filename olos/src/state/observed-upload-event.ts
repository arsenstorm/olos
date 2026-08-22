import { createOlosError } from "../types/errors";
import { timestampMs, timestampString } from "../validation/fields";
import { isOptionalHttpHeaderStringMap } from "../validation/http-header";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertSafeObjectKey } from "../validation/object-key";
import { assertObservedUpload } from "../validation/observed-upload";
import {
  createObservedUploadFromObjectCreatedEvent,
  createUploadCompletionHint,
} from "./observed-upload";
import {
  type CreateObservedUploadFromObjectCreatedEventOptions,
  type CreateUploadCompletionHintOptions,
  type NormalizeUploadEventOptions,
  OBJECT_CREATED_EVENT_TYPE,
  type ObjectCreatedEventSlotResolution,
  type ObjectCreatedUploadEventPayload,
  type ResolveObjectCreatedEventSlotOptions,
  UPLOAD_COMPLETED_HINT_TYPE,
  type UploadCompletionHintPayload,
  type UploadEventNormalization,
} from "./observed-upload-types";

/**
 * Parse an untrusted event payload into a typed upload event. Returns
 * `object_created` or `upload_completed` on success; never throws —
 * payloads that are not objects, carry an unsupported `eventType`, or
 * fail field validation come back as `invalid_event` with the error.
 */
export function normalizeUploadEvent(
  options: NormalizeUploadEventOptions
): UploadEventNormalization {
  if (!isObjectLikeRecord(options.event)) {
    return invalidUploadEvent("upload event must be an object");
  }

  const event = options.event;

  try {
    return normalizeUploadEventPayload(event);
  } catch (error) {
    return invalidUploadEvent(errorMessage(error));
  }
}

function normalizeUploadEventPayload(
  event: Record<string, unknown>
): UploadEventNormalization {
  if (event.eventType === OBJECT_CREATED_EVENT_TYPE) {
    return normalizeObjectCreatedUploadEvent(event);
  }

  if (event.eventType === UPLOAD_COMPLETED_HINT_TYPE) {
    return normalizeUploadCompletedHintEvent(event);
  }

  return invalidUploadEvent("upload event type is unsupported");
}

function normalizeObjectCreatedUploadEvent(
  event: Record<string, unknown>
): UploadEventNormalization {
  return {
    event: createObservedUploadFromObjectCreatedEvent(
      objectCreatedUploadEventPayload(event)
    ),
    status: "object_created",
  };
}

function normalizeUploadCompletedHintEvent(
  event: Record<string, unknown>
): UploadEventNormalization {
  return {
    hint: createUploadCompletionHint(uploadCompletionHintPayload(event)),
    status: "upload_completed",
  };
}

/**
 * Match an object-created event to its upload slot by object key. Returns
 * `matched` when the supplied slot's key equals the event's; otherwise —
 * including when no slot was supplied — `unknown_object_key` with an
 * `olos.unknown_slot` error. Pure.
 */
export function resolveObjectCreatedEventSlot(
  options: ResolveObjectCreatedEventSlotOptions
): ObjectCreatedEventSlotResolution {
  if (
    options.slot !== undefined &&
    options.slot.objectKey === options.event.object.objectKey
  ) {
    return {
      slot: options.slot,
      status: "matched",
    };
  }

  return {
    error: createOlosError(
      "olos.unknown_slot",
      "object-created event does not match a known slot",
      {
        eventId: options.event.eventId,
        objectKey: options.event.object.objectKey,
        providerId: options.event.object.providerId,
        ...(options.slot === undefined
          ? {}
          : {
              slotId: options.slot.slotId,
              slotObjectKey: options.slot.objectKey,
            }),
      }
    ),
    status: "unknown_object_key",
  };
}

function invalidUploadEvent(message: string): UploadEventNormalization {
  return {
    error: createOlosError("olos.invalid_state", message),
    status: "invalid_event",
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "upload event is invalid";
}

function isObjectLikeRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function objectCreatedUploadEventPayload(
  event: Record<string, unknown>
): ObjectCreatedUploadEventPayload {
  assertUrlSafeIdentifier(event.eventId, "objectCreatedEvent.eventId");

  const object = {
    contentType: event.contentType,
    etag: event.etag,
    metadata: optionalUploadEventMetadata(event.metadata),
    objectKey: event.objectKey,
    observedAt: event.eventTime,
    providerId: event.providerId,
    size: event.size,
  };

  assertObservedUpload(object);

  return {
    contentType: object.contentType,
    etag: object.etag,
    eventId: event.eventId,
    eventTime: object.observedAt,
    eventType: OBJECT_CREATED_EVENT_TYPE,
    metadata: object.metadata,
    objectKey: object.objectKey,
    providerId: object.providerId,
    size: object.size,
  };
}

function uploadCompletionHintPayload(
  event: Record<string, unknown>
): UploadCompletionHintPayload {
  const hint = {
    eventId: event.eventId,
    eventTime: event.eventTime,
    eventType: UPLOAD_COMPLETED_HINT_TYPE,
    objectKey: event.objectKey,
    slotId: event.slotId,
  };

  assertUploadCompletionHint(hint);

  return hint;
}

function optionalUploadEventMetadata(
  value: unknown
): Record<string, string | undefined> | undefined {
  if (value === undefined) {
    return;
  }

  if (!isOptionalHttpHeaderStringMap(value)) {
    throw new Error("observedUpload.metadata must be a string map");
  }

  return value;
}

export function assertObjectCreatedEvent(
  options: CreateObservedUploadFromObjectCreatedEventOptions
): void {
  assertUrlSafeIdentifier(options.eventId, "objectCreatedEvent.eventId");

  if (options.eventType !== OBJECT_CREATED_EVENT_TYPE) {
    throw new Error("objectCreatedEvent.eventType must be object.created");
  }
}

export function assertUploadCompletionHint(
  options: unknown
): asserts options is CreateUploadCompletionHintOptions {
  assertUploadCompletionHintEnvelope(options);
  assertUploadCompletionHintIdentifiers(options);
  assertUploadCompletionHintType(options);
  assertUploadCompletionHintTime(options.eventTime);
  assertSafeObjectKey(options.objectKey, "uploadCompletionHint.objectKey");
}

function assertUploadCompletionHintEnvelope(
  options: unknown
): asserts options is Record<string, unknown> {
  if (!isObjectLikeRecord(options)) {
    throw new Error("uploadCompletionHint must be an object");
  }
}

function assertUploadCompletionHintIdentifiers(
  options: Record<string, unknown>
): void {
  assertUrlSafeIdentifier(options.eventId, "uploadCompletionHint.eventId");
  assertUrlSafeIdentifier(options.slotId, "uploadCompletionHint.slotId");
}

function assertUploadCompletionHintType(
  options: Record<string, unknown>
): void {
  if (options.eventType !== UPLOAD_COMPLETED_HINT_TYPE) {
    throw new Error("uploadCompletionHint.eventType must be upload.completed");
  }
}

// Strict RFC 3339, not the lenient `timestampMs`: eventTime lands verbatim
// in commit timestamps, so looser provider formats (HTTP dates) must be
// normalized first — `headObjectTimestamp` is the one lenient site.
function assertUploadCompletionHintTime(eventTime: unknown): void {
  timestampString(eventTime, "uploadCompletionHint.eventTime");
}

export function headObjectTimestamp(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(timestampMs(value, "lastModified")).toISOString();
}
