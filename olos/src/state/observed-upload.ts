import type { OlosError } from "../types/errors";
import { createOlosError } from "../types/errors";
import type { UploadSlot } from "../types/upload-slot";
import { timestampMs } from "../validation/fields";
import { isOptionalHttpHeaderStringMap } from "../validation/http-header";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertSafeObjectKey } from "../validation/object-key";
import {
  assertObservedUpload,
  type ObservedUpload,
} from "../validation/observed-upload";

/** Event type identifying a provider object-created notification. */
export const OBJECT_CREATED_EVENT_TYPE = "object.created";
/** Event type identifying a publisher upload-completion hint. */
export const UPLOAD_COMPLETED_HINT_TYPE = "upload.completed";

/** Options for {@link createObservedUpload}. */
export interface CreateObservedUploadOptions {
  contentType: string;
  etag?: string;
  /** Provider object metadata, as a string map. */
  metadata?: Record<string, string | undefined>;
  objectKey: string;
  /** ISO timestamp when the provider observed the object. */
  observedAt: string;
  providerId: string;
  /** Object size in bytes. */
  size: number;
}

/** Options for {@link createObservedUploadFromObjectCreatedEvent}. */
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

/**
 * Options for {@link createObservedUploadFromHeadObject}, mirroring the
 * fields of an S3-style HeadObject response.
 */
export interface CreateObservedUploadFromHeadObjectOptions {
  /** HeadObject content length; becomes the observed upload's `size`. */
  contentLength: number;
  contentType: string;
  etag?: string;
  /** HeadObject last-modified time; becomes the observation timestamp. */
  lastModified: string | Date;
  metadata?: Record<string, string | undefined>;
  objectKey: string;
  providerId: string;
}

/** Options for {@link createUploadCompletionHint}. */
export interface CreateUploadCompletionHintOptions {
  eventId: string;
  eventTime: string;
  eventType: typeof UPLOAD_COMPLETED_HINT_TYPE;
  objectKey: string;
  slotId: string;
}

/** Normalized provider object-created event carrying the observed upload. */
export interface ObservedUploadObjectCreatedEvent {
  eventId: string;
  eventType: typeof OBJECT_CREATED_EVENT_TYPE;
  object: ObservedUpload;
}

/**
 * Publisher-sent hint that an upload finished, usable before provider
 * evidence (the object-created event or a HeadObject probe) arrives.
 */
export interface UploadCompletionHint {
  eventId: string;
  eventTime: string;
  eventType: typeof UPLOAD_COMPLETED_HINT_TYPE;
  objectKey: string;
  slotId: string;
}

/** Options for {@link resolveObjectCreatedEventObservation}. */
export interface ResolveObjectCreatedEventObservationOptions {
  event: ObservedUploadObjectCreatedEvent;
  /** Event IDs already processed, used to detect duplicate deliveries. */
  observedEventIds: ReadonlySet<string> | readonly string[];
}

/** Options for {@link resolveObjectCreatedEventSlot}. */
export interface ResolveObjectCreatedEventSlotOptions {
  event: ObservedUploadObjectCreatedEvent;
  /** Slot whose object key may match the event; omit when none was found. */
  slot?: UploadSlot;
}

/** Options for {@link resolveUploadEvidence}. */
export interface ResolveUploadEvidenceOptions {
  /** Publisher completion hint, when one has been received. */
  hint?: UploadCompletionHint;
  /** Provider-observed object, when one has been received. */
  object?: ObservedUpload;
}

/** Options for {@link normalizeUploadEvent}. */
export interface NormalizeUploadEventOptions {
  /** Untrusted event payload, e.g. a parsed webhook body. */
  event: unknown;
}

type ObjectCreatedUploadEventPayload =
  CreateObservedUploadFromObjectCreatedEventOptions;

type UploadCompletionHintPayload = CreateUploadCompletionHintOptions;

/**
 * Outcome of {@link resolveObjectCreatedEventObservation}: `observed` for
 * a first delivery, `duplicate` for an event ID seen before.
 */
export type ObjectCreatedEventObservationResolution =
  | {
      event: ObservedUploadObjectCreatedEvent;
      status: "observed";
    }
  | {
      eventId: string;
      status: "duplicate";
    };

/**
 * Outcome of {@link resolveObjectCreatedEventSlot}: `matched` with the
 * slot, or `unknown_object_key` with an `olos.unknown_slot` error.
 */
export type ObjectCreatedEventSlotResolution =
  | {
      slot: UploadSlot;
      status: "matched";
    }
  | {
      error: OlosError;
      status: "unknown_object_key";
    };

/**
 * Outcome of {@link resolveUploadEvidence}: `object_observed` once
 * provider evidence exists, `awaiting_object` when only the publisher
 * hint has arrived, `idle` when neither has, and `conflict` when the
 * hint and observed object disagree on the object key.
 */
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

/**
 * Outcome of {@link normalizeUploadEvent}: a typed `object_created` event,
 * a typed `upload_completed` hint, or `invalid_event` with the
 * validation error.
 */
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

/**
 * Build a validated {@link ObservedUpload} record from provider
 * observation fields. Optional `etag` and `metadata` are omitted from the
 * result rather than set to undefined. Pure; throws when validation
 * fails.
 */
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

/**
 * Normalize a provider object-created notification into an
 * {@link ObservedUploadObjectCreatedEvent}; the event time becomes the
 * observation timestamp. Pure; throws when `eventType` is not
 * `object.created` or the payload fails validation.
 */
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

/**
 * Build an {@link ObservedUpload} from an S3-style HeadObject response:
 * `contentLength` becomes the size and `lastModified` (string or `Date`)
 * the observation timestamp. Pure; throws when validation fails.
 */
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

/**
 * Build a validated {@link UploadCompletionHint} from a publisher's
 * upload-completed notification. Pure; throws when `eventType` is not
 * `upload.completed` or any identifier, timestamp, or object key is
 * invalid.
 */
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

/**
 * Deduplicate an object-created event by its event ID: returns `observed`
 * for a first delivery and `duplicate` when the ID is already in
 * `observedEventIds`. Pure; the caller records observed IDs itself.
 */
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

/**
 * Combine the two kinds of upload evidence — the provider-observed object
 * and the publisher's completion hint. The object alone, or together with
 * a hint for the same object key, yields `object_observed`; a hint alone
 * yields `awaiting_object`; neither yields `idle`; an object/hint object
 * key mismatch yields `conflict` with an `olos.key_mismatch` error. Pure.
 */
export function resolveUploadEvidence(
  options: ResolveUploadEvidenceOptions
): UploadEvidenceResolution {
  if (options.object !== undefined && options.hint !== undefined) {
    return resolveCompleteUploadEvidence(options.object, options.hint);
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

function resolveCompleteUploadEvidence(
  object: ObservedUpload,
  hint: UploadCompletionHint
): UploadEvidenceResolution {
  if (object.objectKey !== hint.objectKey) {
    return conflictingUploadEvidence(object, hint);
  }

  return observedUploadEvidence(object);
}

function observedUploadEvidence(
  object: ObservedUpload
): UploadEvidenceResolution {
  return {
    object,
    status: "object_observed",
  };
}

function conflictingUploadEvidence(
  object: ObservedUpload,
  hint: UploadCompletionHint
): UploadEvidenceResolution {
  return {
    error: createOlosError(
      "olos.key_mismatch",
      "upload hint does not match observed object",
      {
        hintEventId: hint.eventId,
        hintObjectKey: hint.objectKey,
        objectKey: object.objectKey,
        slotId: hint.slotId,
      }
    ),
    status: "conflict",
  };
}

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

function assertUploadCompletionHintTime(eventTime: unknown): void {
  if (typeof eventTime !== "string") {
    throw new Error("uploadCompletionHint.eventTime must be a valid timestamp");
  }

  timestampMs(eventTime, "uploadCompletionHint.eventTime");
}

function headObjectTimestamp(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Normalize string inputs (e.g. an HTTP `Last-Modified` header) to RFC
  // 3339 — downstream validation accepts nothing looser.
  return new Date(timestampMs(value, "lastModified")).toISOString();
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
