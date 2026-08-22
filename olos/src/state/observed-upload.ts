import { createOlosError } from "../types/errors";
import {
  assertObservedUpload,
  type ObservedUpload,
} from "../validation/observed-upload";
import {
  assertObjectCreatedEvent,
  assertUploadCompletionHint,
  headObjectTimestamp,
} from "./observed-upload-event";
import type {
  CreateObservedUploadFromHeadObjectOptions,
  CreateObservedUploadFromObjectCreatedEventOptions,
  CreateObservedUploadOptions,
  CreateUploadCompletionHintOptions,
  ObservedUploadObjectCreatedEvent,
  ResolveUploadEvidenceOptions,
  UploadCompletionHint,
  UploadEvidenceResolution,
} from "./observed-upload-types";
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
