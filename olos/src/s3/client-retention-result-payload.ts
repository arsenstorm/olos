import {
  requiredArrayField,
  requiredRecord,
  requiredStringField,
} from "../runtime/http-client";
import type {
  S3RuntimeRetentionDeletedObjectsPayload,
  S3RuntimeRetentionFailedObjectPayload,
  S3RuntimeRetiredObjectPayload,
} from "./client-payload-types";
import { retiredObjectPayload } from "./client-summary-payload";
import type { StoredS3CoordinatorRetentionResponse } from "./http-types";

const S3_RETENTION_RESULT_ENVELOPE_MESSAGE =
  "S3 retention response must include result and summary";
const S3_RETENTION_RESULT_DELETED_OBJECTS_MESSAGE =
  "S3 retention response result must include deletedObjects";
const S3_RETENTION_RESULT_FAILED_OBJECTS_MESSAGE =
  "S3 retention response result must include failedObjects";

export function retentionResultPayload(
  value: unknown
): StoredS3CoordinatorRetentionResponse["result"] {
  const record = requiredRecord(value, S3_RETENTION_RESULT_ENVELOPE_MESSAGE);

  return {
    deletedObjects: retentionDeletedObjectsPayload(record),
    failedObjects: retentionFailedObjectsPayload(record),
  };
}

function retentionDeletedObjectsPayload(
  value: Record<string, unknown>
): S3RuntimeRetentionDeletedObjectsPayload {
  return retentionRetiredObjectCollectionPayload(
    value,
    "deletedObjects",
    S3_RETENTION_RESULT_DELETED_OBJECTS_MESSAGE,
    "S3 retention response result.deletedObjects"
  );
}

export function retentionRetiredObjectCollectionPayload(
  value: Record<string, unknown>,
  field: "deletedObjects" | "retiredObjects",
  message: string,
  context: string
): S3RuntimeRetiredObjectPayload[] {
  return requiredArrayField(value, field, message).map((entry, index) =>
    retiredObjectPayload(entry, `${context}[${index}]`)
  );
}

function retentionFailedObjectsPayload(
  value: Record<string, unknown>
): StoredS3CoordinatorRetentionResponse["result"]["failedObjects"] {
  const failedObjects = requiredArrayField(
    value,
    "failedObjects",
    S3_RETENTION_RESULT_FAILED_OBJECTS_MESSAGE
  );

  return failedObjects.map((entry, index) =>
    retentionFailedObjectPayload(entry, index)
  );
}

function retentionFailedObjectPayload(
  value: unknown,
  index: number
): S3RuntimeRetentionFailedObjectPayload {
  const failure = requiredRecord(value, retentionFailedObjectContext(index));

  const object = retiredObjectPayload(
    failure.object,
    retentionFailedObjectObjectContext(index)
  );

  return {
    error: requiredStringField(
      failure,
      "error",
      retentionFailedObjectErrorContext(index)
    ),
    object,
  };
}

function retentionFailedObjectContext(index: number): string {
  return `S3 retention response result.failedObjects[${index}] must be an object`;
}

function retentionFailedObjectObjectContext(index: number): string {
  return `S3 retention response result.failedObjects[${index}].object`;
}

function retentionFailedObjectErrorContext(index: number): string {
  return `S3 retention response result.failedObjects[${index}].error must be set`;
}
