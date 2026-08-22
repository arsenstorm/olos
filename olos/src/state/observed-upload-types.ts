import type { OlosError } from "../types/errors";
import type { UploadSlot } from "../types/upload-slot";
import type { ObservedUpload } from "../validation/observed-upload";
import {
  normalizeUploadEvent,
  resolveObjectCreatedEventSlot,
} from "./observed-upload-event";
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

export type UploadCompletionHintPayload = CreateUploadCompletionHintOptions;

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
