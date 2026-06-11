import type { OlosError } from "../types/errors";
import type { UploadSlot } from "../types/upload-slot";
import { assertUrlSafeIdentifier } from "../validation/ids";
import {
  assertObservedUpload,
  type ObservedUpload,
} from "../validation/observed-upload";

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
        error: {
          error: {
            code: "olos.key_mismatch",
            details: {
              hintEventId: options.hint.eventId,
              hintObjectKey: options.hint.objectKey,
              objectKey: options.object.objectKey,
              slotId: options.hint.slotId,
            },
            message: "upload hint does not match observed object",
          },
        },
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
    error: {
      error: {
        code: "olos.unknown_slot",
        details: {
          eventId: options.event.eventId,
          objectKey: options.event.object.objectKey,
          providerId: options.event.object.providerId,
          ...(options.slot === undefined
            ? {}
            : {
                slotId: options.slot.slotId,
                slotObjectKey: options.slot.objectKey,
              }),
        },
        message: "object-created event does not match a known slot",
      },
    },
    status: "unknown_object_key",
  };
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
  options: CreateUploadCompletionHintOptions
): void {
  assertUrlSafeIdentifier(options.eventId, "uploadCompletionHint.eventId");
  assertUrlSafeIdentifier(options.slotId, "uploadCompletionHint.slotId");

  if (options.eventType !== UPLOAD_COMPLETED_HINT_TYPE) {
    throw new Error("uploadCompletionHint.eventType must be upload.completed");
  }

  if (Number.isNaN(Date.parse(options.eventTime))) {
    throw new Error("uploadCompletionHint.eventTime must be a valid timestamp");
  }

  if (options.objectKey.trim() === "") {
    throw new Error("uploadCompletionHint.objectKey must be non-empty");
  }
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
