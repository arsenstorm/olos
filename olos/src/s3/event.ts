import type { UploadEventNormalization } from "../state/observed-upload";
import { normalizeUploadEvent } from "../state/observed-upload";

const DEFAULT_S3_EVENT_CONTENT_TYPE = "application/octet-stream";

export interface NormalizeS3ObjectCreatedEventRecordOptions {
  contentType?: string;
  providerId: string;
  record: unknown;
}

export interface NormalizeS3ObjectCreatedEventsOptions {
  contentType?: string;
  payload: unknown;
  providerId: string;
}

export function normalizeS3ObjectCreatedEvents(
  options: NormalizeS3ObjectCreatedEventsOptions
): readonly UploadEventNormalization[] {
  const payload = asRecord(options.payload);
  const records = Array.isArray(payload?.Records) ? payload.Records : undefined;

  if (records === undefined) {
    return [invalidS3Event("s3 event payload must contain Records")];
  }

  return records.map((record) =>
    normalizeS3ObjectCreatedEventRecord({
      contentType: options.contentType,
      providerId: options.providerId,
      record,
    })
  );
}

export function normalizeS3ObjectCreatedEventRecord(
  options: NormalizeS3ObjectCreatedEventRecordOptions
): UploadEventNormalization {
  const record = asRecord(options.record);
  const object = asRecord(asRecord(record?.s3)?.object);

  if (record === undefined || object === undefined) {
    return invalidS3Event("s3 event record is invalid");
  }

  if (!isObjectCreatedEventName(record.eventName)) {
    return invalidS3Event("s3 event record is not object-created");
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

function eventId(
  record: Record<string, unknown>,
  object: Record<string, unknown>
): string | undefined {
  const requestId = stringValue(
    asRecord(record.responseElements)?.["x-amz-request-id"]
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
    return decodeURIComponent(key.replaceAll("+", " "));
  } catch {
    return;
  }
}

function isObjectCreatedEventName(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("ObjectCreated:");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return;
  }

  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function invalidS3Event(message: string): UploadEventNormalization {
  return {
    error: {
      error: {
        code: "olos.invalid_state",
        message,
      },
    },
    status: "invalid_event",
  };
}
