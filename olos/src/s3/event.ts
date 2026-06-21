import type { UploadEventNormalization } from "../state/observed-upload";
import { normalizeUploadEvent } from "../state/observed-upload";
import { createOlosError } from "../types/errors";
import { recordValue } from "../validation/fields";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertSafeObjectKey } from "../validation/object-key";
import { assertS3BucketName } from "./bucket";

const DEFAULT_S3_EVENT_CONTENT_TYPE = "application/octet-stream";

// S3 event policy is the ingress boundary for external provider payloads. We
// only trust normalized, decoded object keys and strict provider/bucket fields
// before turning events into internal upload-normalization records.

export interface NormalizeS3ObjectCreatedEventRecordOptions {
  contentType?: string;
  expectedBucket?: string;
  providerId: string;
  record: unknown;
}

export interface NormalizeS3ObjectCreatedEventsOptions {
  contentType?: string;
  expectedBucket?: string;
  payload: unknown;
  providerId: string;
}

export function normalizeS3ObjectCreatedEvents(
  options: NormalizeS3ObjectCreatedEventsOptions
): readonly UploadEventNormalization[] {
  const payload = recordValue(options.payload);
  const records = Array.isArray(payload?.Records) ? payload.Records : undefined;

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

export function normalizeS3ObjectCreatedEventRecord(
  options: NormalizeS3ObjectCreatedEventRecordOptions
): UploadEventNormalization {
  if (!isProviderId(options.providerId)) {
    return invalidS3Event("providerId must be a non-empty URL-safe identifier");
  }

  if (
    options.expectedBucket !== undefined &&
    !isS3BucketName(options.expectedBucket)
  ) {
    return invalidS3Event("expectedBucket is invalid");
  }

  const record = recordValue(options.record);
  const s3 = recordValue(record?.s3);
  const bucket = recordValue(s3?.bucket);
  const object = recordValue(s3?.object);

  if (record === undefined || bucket === undefined || object === undefined) {
    return invalidS3Event("s3 event record is invalid");
  }

  if (!isObjectCreatedEventName(record.eventName)) {
    return invalidS3Event("s3 event record is not object-created");
  }

  if (!isS3BucketName(bucket.name)) {
    return invalidS3Event("s3 event bucket is invalid");
  }

  if (
    options.expectedBucket !== undefined &&
    bucket.name !== options.expectedBucket
  ) {
    return invalidS3Event("s3 event bucket does not match expected bucket");
  }

  const key = objectKey(object.key);
  const id = eventId(record, object);

  if (key === undefined) {
    return invalidS3Event("s3 object key is invalid");
  }

  if (id === undefined) {
    return invalidS3Event(
      "s3 event record must include a request id or sequencer"
    );
  }

  return normalizeUploadEvent({
    event: {
      contentType: options.contentType ?? DEFAULT_S3_EVENT_CONTENT_TYPE,
      etag: stringValue(object.eTag),
      eventId: id,
      eventTime: record.eventTime,
      eventType: "object.created",
      objectKey: key,
      providerId: options.providerId,
      size: object.size,
    },
  });
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
    return;
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
