import type { OlosError } from "../types/errors";
import { createOlosError } from "../types/errors";
import type { UploadSlot } from "../types/upload-slot";
import { isOptionalHttpHeaderStringMap } from "../validation/http-header";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertSafeObjectKey } from "../validation/object-key";
import {
  assertObservedUpload,
  type ObservedUpload,
} from "../validation/observed-upload";
import { timestampMs } from "./timestamp";

export const OBJECT_CREATED_EVENT_TYPE = "object.created";
export const UPLOAD_COMPLETED_HINT_TYPE = "upload.completed";

export interface CreateObservedUploadOptions {
  contentType: string;
  etag?: string;
  metadata?: Record<string, string | undefined>;
  objectKey: string;
  observedAt: string;
  providerId: string;
  size: number;
}

export interface CreateObservedUploadFromObjectCreatedEventOptions {
  contentType: string;
  etag?: string;
  eventId: string;
  eventTime: string;
  eventType: typeof OBJECT_CREATED_EVENT_TYPE;
  metadata?: Record<string, string | undefined>;
  objectKey: string;
  providerId: string;
  size: number;
}

export interface CreateObservedUploadFromHeadObjectOptions {
  contentLength: number;
  contentType: string;
  etag?: string;
  lastModified: string | Date;
  metadata?: Record<string, string | undefined>;
  objectKey: string;
  providerId: string;
}

export interface CreateUploadCompletionHintOptions {
  eventId: string;
  eventTime: string;
  eventType: typeof UPLOAD_COMPLETED_HINT_TYPE;
  objectKey: string;
  slotId: string;
}

export interface ObservedUploadObjectCreatedEvent {
  eventId: string;
  eventType: typeof OBJECT_CREATED_EVENT_TYPE;
  object: ObservedUpload;
}

export interface UploadCompletionHint {
  eventId: string;
  eventTime: string;
  eventType: typeof UPLOAD_COMPLETED_HINT_TYPE;
  objectKey: string;
  slotId: string;
}

export interface ResolveObjectCreatedEventObservationOptions {
  event: ObservedUploadObjectCreatedEvent;
  observedEventIds: ReadonlySet<string> | readonly string[];
}

export interface ResolveObjectCreatedEventSlotOptions {
  event: ObservedUploadObjectCreatedEvent;
  slot?: UploadSlot;
}

export interface ResolveUploadEvidenceOptions {
  hint?: UploadCompletionHint;
  object?: ObservedUpload;
}

export interface NormalizeUploadEventOptions {
  event: unknown;
}

type ObjectCreatedUploadEventPayload =
  CreateObservedUploadFromObjectCreatedEventOptions;

type UploadCompletionHintPayload = CreateUploadCompletionHintOptions;

export type ObjectCreatedEventObservationResolution =
  | {
      event: ObservedUploadObjectCreatedEvent;
      status: "observed";
    }
  | {
      eventId: string;
      status: "duplicate";
    };

export type ObjectCreatedEventSlotResolution =
  | {
      slot: UploadSlot;
      status: "matched";
    }
  | {
      error: OlosError;
      status: "unknown_object_key";
    };

export type UploadEvidenceResolution =
  | {
      object: ObservedUpload;
      status: "object_observed";
    }
  | {
      hint: UploadCompletionHint;
      status: "awaiting_object";
    }
  | {
      error: OlosError;
      status: "conflict";
    }
  | {
      status: "idle";
    };

export type UploadEventNormalization =
  | {
      event: ObservedUploadObjectCreatedEvent;
      status: "object_created";
    }
  | {
      hint: UploadCompletionHint;
      status: "upload_completed";
    }
  | {
      error: OlosError;
      status: "invalid_event";
    };

export function createObservedUpload(
  options: CreateObservedUploadOptions
): ObservedUpload {
  const object: ObservedUpload = {
    contentType: options.contentType,
    ...(options.etag === undefined ? {} : { etag: options.etag }),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    objectKey: options.objectKey,
    observedAt: options.observedAt,
    providerId: options.providerId,
    size: options.size,
  };

  assertObservedUpload(object);
  return object;
}

export function createObservedUploadFromObjectCreatedEvent(
  options: CreateObservedUploadFromObjectCreatedEventOptions
): ObservedUploadObjectCreatedEvent {
  assertObjectCreatedEvent(options);

  return {
    eventId: options.eventId,
    eventType: options.eventType,
    object: createObservedUpload({
      contentType: options.contentType,
      etag: options.etag,
      metadata: options.metadata,
      objectKey: options.objectKey,
      observedAt: options.eventTime,
      providerId: options.providerId,
      size: options.size,
    }),
  };
}

export function createObservedUploadFromHeadObject(
  options: CreateObservedUploadFromHeadObjectOptions
): ObservedUpload {
  return createObservedUpload({
    contentType: options.contentType,
    etag: options.etag,
    metadata: options.metadata,
    objectKey: options.objectKey,
    observedAt: headObjectTimestamp(options.lastModified),
    providerId: options.providerId,
    size: options.contentLength,
  });
}

export function createUploadCompletionHint(
  options: CreateUploadCompletionHintOptions
): UploadCompletionHint {
  assertUploadCompletionHint(options);

  return {
    eventId: options.eventId,
    eventTime: options.eventTime,
    eventType: options.eventType,
    objectKey: options.objectKey,
    slotId: options.slotId,
  };
}

export function resolveObjectCreatedEventObservation(
  options: ResolveObjectCreatedEventObservationOptions
): ObjectCreatedEventObservationResolution {
  if (hasObservedEvent(options.observedEventIds, options.event.eventId)) {
    return {
      eventId: options.event.eventId,
      status: "duplicate",
    };
  }

  return {
    event: options.event,
    status: "observed",
  };
}

export function resolveUploadEvidence(
  options: ResolveUploadEvidenceOptions
): UploadEvidenceResolution {
  if (options.object !== undefined && options.hint !== undefined) {
    if (options.object.objectKey !== options.hint.objectKey) {
      return {
        error: createOlosError(
          "olos.key_mismatch",
          "upload hint does not match observed object",
          {
            hintEventId: options.hint.eventId,
            hintObjectKey: options.hint.objectKey,
            objectKey: options.object.objectKey,
            slotId: options.hint.slotId,
          }
        ),
        status: "conflict",
      };
    }

    return {
      object: options.object,
      status: "object_observed",
    };
  }

  if (options.object !== undefined) {
    return {
      object: options.object,
      status: "object_observed",
    };
  }

  if (options.hint !== undefined) {
    return {
      hint: options.hint,
      status: "awaiting_object",
    };
  }

  return { status: "idle" };
}

export function normalizeUploadEvent(
  options: NormalizeUploadEventOptions
): UploadEventNormalization {
  if (!isObjectLikeRecord(options.event)) {
    return invalidUploadEvent("upload event must be an object");
  }

  const event = options.event;

  try {
    if (event.eventType === OBJECT_CREATED_EVENT_TYPE) {
      return {
        event: createObservedUploadFromObjectCreatedEvent(
          objectCreatedUploadEventPayload(event)
        ),
        status: "object_created",
      };
    }

    if (event.eventType === UPLOAD_COMPLETED_HINT_TYPE) {
      return {
        hint: createUploadCompletionHint(uploadCompletionHintPayload(event)),
        status: "upload_completed",
      };
    }
  } catch (error) {
    return invalidUploadEvent(errorMessage(error));
  }

  return invalidUploadEvent("upload event type is unsupported");
}

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

function assertObjectCreatedEvent(
  options: CreateObservedUploadFromObjectCreatedEventOptions
): void {
  assertUrlSafeIdentifier(options.eventId, "objectCreatedEvent.eventId");

  if (options.eventType !== OBJECT_CREATED_EVENT_TYPE) {
    throw new Error("objectCreatedEvent.eventType must be object.created");
  }
}

function assertUploadCompletionHint(
  options: unknown
): asserts options is CreateUploadCompletionHintOptions {
  if (!isObjectLikeRecord(options)) {
    throw new Error("uploadCompletionHint must be an object");
  }

  assertUrlSafeIdentifier(options.eventId, "uploadCompletionHint.eventId");
  assertUrlSafeIdentifier(options.slotId, "uploadCompletionHint.slotId");

  if (options.eventType !== UPLOAD_COMPLETED_HINT_TYPE) {
    throw new Error("uploadCompletionHint.eventType must be upload.completed");
  }

  if (typeof options.eventTime !== "string") {
    throw new Error("uploadCompletionHint.eventTime must be a valid timestamp");
  }

  timestampMs(options.eventTime, "uploadCompletionHint.eventTime");

  assertSafeObjectKey(options.objectKey, "uploadCompletionHint.objectKey");
}

function headObjectTimestamp(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function hasObservedEvent(
  observedEventIds: ReadonlySet<string> | readonly string[],
  eventId: string
): boolean {
  if ("has" in observedEventIds) {
    return observedEventIds.has(eventId);
  }

  return observedEventIds.includes(eventId);
}
