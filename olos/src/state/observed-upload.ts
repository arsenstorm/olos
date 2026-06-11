import type { OlosError } from "../types/errors";
import type { UploadSlot } from "../types/upload-slot";
import { assertUrlSafeIdentifier } from "../validation/ids";
import {
  assertObservedUpload,
  type ObservedUpload,
} from "../validation/observed-upload";

export const OBJECT_CREATED_EVENT_TYPE = "object.created";

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

export interface ObservedUploadObjectCreatedEvent {
  eventId: string;
  eventType: typeof OBJECT_CREATED_EVENT_TYPE;
  object: ObservedUpload;
}

export interface ResolveObjectCreatedEventObservationOptions {
  event: ObservedUploadObjectCreatedEvent;
  observedEventIds: ReadonlySet<string> | readonly string[];
}

export interface ResolveObjectCreatedEventSlotOptions {
  event: ObservedUploadObjectCreatedEvent;
  slot?: UploadSlot;
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
