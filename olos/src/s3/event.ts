import { normalizeUploadEvent } from "../state/observed-upload-event";
import type { UploadEventNormalization } from "../state/observed-upload-types";
import { createOlosError } from "../types/errors";
import { recordValue } from "../validation/fields";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertSafeObjectKey } from "../validation/object-key";
import { assertS3BucketName } from "./bucket";

const DEFAULT_S3_EVENT_CONTENT_TYPE = "application/octet-stream";

// S3 event policy is the ingress boundary for external provider payloads. We
// only trust normalized, decoded object keys and strict provider/bucket fields
// before turning events into internal upload-normalization records.

/** Options for {@link normalizeS3ObjectCreatedEventRecord}. */
export interface NormalizeS3ObjectCreatedEventRecordOptions {
  /** Assumed object content type (default `application/octet-stream`). */
  contentType?: string;
  /** When set, records for any other bucket normalize to `invalid_event`. */
  expectedBucket?: string;
  providerId: string;
  /** One untrusted entry from an S3 event notification's `Records` array. */
  record: unknown;
}

/** Options for {@link normalizeS3ObjectCreatedEvents}. */
export interface NormalizeS3ObjectCreatedEventsOptions {
  /** Assumed object content type (default `application/octet-stream`). */
  contentType?: string;
  /** When set, records for any other bucket normalize to `invalid_event`. */
  expectedBucket?: string;
  /** Untrusted S3 event notification body (`{ Records: [...] }`). */
  payload: unknown;
  providerId: string;
}

interface S3ObjectCreatedEventRecordParts {
  bucket: Record<string, unknown>;
  object: Record<string, unknown>;
  record: Record<string, unknown>;
}

type S3ObjectCreatedEventIdentity =
  | {
      eventId: string;
      objectKey: string;
      status: "valid";
    }
  | {
      normalization: UploadEventNormalization;
      status: "invalid";
    };

/**
 * Normalize an untrusted S3 event notification payload into one upload
 * normalization per record. Never throws: a payload without a `Records`
 * array yields a single `invalid_event` entry, and each malformed record
 * normalizes to its own `invalid_event` while valid siblings pass through.
 */
export function normalizeS3ObjectCreatedEvents(
  options: NormalizeS3ObjectCreatedEventsOptions
): readonly UploadEventNormalization[] {
  const records = s3ObjectCreatedEventRecords(options.payload);

  if (records === undefined) {
    return [invalidS3Event("s3 event payload must contain Records")];
  }

  return records.map((record) =>
    normalizeS3ObjectCreatedEventRecord({
      contentType: options.contentType,
      expectedBucket: options.expectedBucket,
      providerId: options.providerId,
      record,
    })
  );
}

function s3ObjectCreatedEventRecords(payload: unknown): unknown[] | undefined {
  const record = recordValue(payload);

  return Array.isArray(record?.Records) ? record.Records : undefined;
}

/**
 * Normalize a single untrusted S3 `ObjectCreated:*` event record into an
 * upload event normalization. Validates the bucket, URL-decodes the object
 * key (S3 encodes keys with `+` for spaces) and checks it is safe, and
 * derives the event id from the request id or sequencer. Never throws — any
 * validation failure returns an `invalid_event` normalization with an
 * `olos.invalid_state` error instead.
 */
export function normalizeS3ObjectCreatedEventRecord(
  options: NormalizeS3ObjectCreatedEventRecordOptions
): UploadEventNormalization {
  const optionsError = invalidS3EventRecordOptions(options);

  if (optionsError !== undefined) {
    return optionsError;
  }

  const parts = s3ObjectCreatedEventRecordParts(options.record);

  if (parts === undefined) {
    return invalidS3Event("s3 event record is invalid");
  }

  const recordError = invalidS3ObjectCreatedEventRecordParts(
    parts,
    options.expectedBucket
  );

  if (recordError !== undefined) {
    return recordError;
  }

  const identity = s3ObjectCreatedEventIdentity(parts);

  if (identity.status === "invalid") {
    return identity.normalization;
  }

  return normalizeS3ObjectCreatedUploadEvent(options, parts, identity);
}

function normalizeS3ObjectCreatedUploadEvent(
  options: NormalizeS3ObjectCreatedEventRecordOptions,
  parts: S3ObjectCreatedEventRecordParts,
  identity: Extract<S3ObjectCreatedEventIdentity, { status: "valid" }>
): UploadEventNormalization {
  return normalizeUploadEvent({
    event: {
      contentType: options.contentType ?? DEFAULT_S3_EVENT_CONTENT_TYPE,
      etag: stringValue(parts.object.eTag),
      eventId: identity.eventId,
      eventTime: parts.record.eventTime,
      eventType: "object.created",
      objectKey: identity.objectKey,
      providerId: options.providerId,
      size: parts.object.size,
    },
  });
}

function invalidS3EventRecordOptions(
  options: NormalizeS3ObjectCreatedEventRecordOptions
): UploadEventNormalization | undefined {
  if (!isProviderId(options.providerId)) {
    return invalidS3Event("providerId must be a non-empty URL-safe identifier");
  }

  if (
    options.expectedBucket !== undefined &&
    !isS3BucketName(options.expectedBucket)
  ) {
    return invalidS3Event("expectedBucket is invalid");
  }
}

function invalidS3ObjectCreatedEventRecordParts(
  parts: S3ObjectCreatedEventRecordParts,
  expectedBucket: string | undefined
): UploadEventNormalization | undefined {
  if (!isObjectCreatedEventName(parts.record.eventName)) {
    return invalidS3Event("s3 event record is not object-created");
  }

  if (!isS3BucketName(parts.bucket.name)) {
    return invalidS3Event("s3 event bucket is invalid");
  }

  if (expectedBucket !== undefined && parts.bucket.name !== expectedBucket) {
    return invalidS3Event("s3 event bucket does not match expected bucket");
  }
}

function s3ObjectCreatedEventRecordParts(
  value: unknown
): S3ObjectCreatedEventRecordParts | undefined {
  const record = recordValue(value);
  const s3 = recordValue(record?.s3);
  const bucket = recordValue(s3?.bucket);
  const object = recordValue(s3?.object);

  if (record === undefined || bucket === undefined || object === undefined) {
    return;
  }

  return { bucket, object, record };
}

function s3ObjectCreatedEventIdentity(
  parts: S3ObjectCreatedEventRecordParts
): S3ObjectCreatedEventIdentity {
  const key = objectKey(parts.object.key);
  const id = eventId(parts.record, parts.object);

  if (key === undefined) {
    return {
      normalization: invalidS3Event("s3 object key is invalid"),
      status: "invalid",
    };
  }

  if (id === undefined) {
    return {
      normalization: invalidS3Event(
        "s3 event record must include a request id or sequencer"
      ),
      status: "invalid",
    };
  }

  return { eventId: id, objectKey: key, status: "valid" };
}

function isProviderId(value: string): boolean {
  try {
    assertUrlSafeIdentifier(value, "providerId");
    return true;
  } catch {
    return false;
  }
}

function eventId(
  record: Record<string, unknown>,
  object: Record<string, unknown>
): string | undefined {
  const requestId = stringValue(
    recordValue(record.responseElements)?.["x-amz-request-id"]
  );

  if (requestId !== undefined) {
    return requestId;
  }

  const sequencer = stringValue(object.sequencer);

  if (sequencer !== undefined) {
    return `s3_${sequencer}`;
  }
}

function objectKey(value: unknown): string | undefined {
  const key = stringValue(value);

  if (key === undefined) {
    return;
  }

  try {
    const decoded = decodeURIComponent(key.replaceAll("+", " "));
    assertSafeObjectKey(decoded, "s3 object key");

    return decoded;
  } catch {
    // a key that fails to decode, or decodes to an unsafe path, is not usable
  }
}

function isObjectCreatedEventName(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("ObjectCreated:");
}

function isS3BucketName(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  try {
    assertS3BucketName(value);
    return true;
  } catch {
    return false;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function invalidS3Event(message: string): UploadEventNormalization {
  return {
    error: createOlosError("olos.invalid_state", message),
    status: "invalid_event",
  };
}
