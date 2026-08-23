import {
  requiredArrayField,
  requiredRecord,
  requiredRecordField,
  requiredStringField,
} from "../runtime/http-client";
import type { Cursor } from "../types/cursor";
import type { UploadSlot } from "../types/upload-slot";
import { parseCursor } from "../validation/cursor";
import { errorMessage, isRecord } from "../validation/fields";
import { parseUploadSlot } from "../validation/upload-slot";
import {
  indexedFieldContext,
  requiredStringArrayField,
  retiredObjectPayload,
  summaryCounts,
  summaryOk,
} from "./client-payload-shared";
import type {
  S3RuntimeRetentionDeletedObjectsPayload,
  S3RuntimeRetentionExpiredSlotsPayload,
  S3RuntimeRetentionFailedObjectPayload,
  S3RuntimeRetentionPayloadFields,
  S3RuntimeRetentionRetiredObjectsPayload,
  S3RuntimeRetentionSummaryArrays,
  S3RuntimeRetentionSummaryCounts,
  S3RuntimeRetiredObjectPayload,
} from "./client-payload-types";
import type { StoredS3CoordinatorRetentionResponse } from "./http-types";

const S3_RETENTION_RESPONSE_ENVELOPE_MESSAGE =
  "S3 retention response must include plan and summary";
const S3_RETENTION_RESPONSE_PLAN_MESSAGE =
  "S3 retention response must include plan";
const S3_RETENTION_RESPONSE_RESULT_MESSAGE =
  "S3 retention response must include result";
const S3_RETENTION_RESPONSE_SUMMARY_MESSAGE =
  "S3 retention response must include summary";

export function retentionPayload(
  value: unknown
): StoredS3CoordinatorRetentionResponse {
  const record = requiredRecord(value, S3_RETENTION_RESPONSE_ENVELOPE_MESSAGE);

  const fields = retentionPayloadFields(record);

  return {
    plan: retentionPlanPayload(fields.plan),
    result: retentionResultPayload(fields.result),
    summary: retentionSummary(fields.summary),
  };
}

function retentionPayloadFields(
  value: Record<string, unknown>
): S3RuntimeRetentionPayloadFields {
  return {
    plan: requiredRecordField(
      value,
      "plan",
      S3_RETENTION_RESPONSE_PLAN_MESSAGE
    ),
    result: requiredRecordField(
      value,
      "result",
      S3_RETENTION_RESPONSE_RESULT_MESSAGE
    ),
    summary: requiredRecordField(
      value,
      "summary",
      S3_RETENTION_RESPONSE_SUMMARY_MESSAGE
    ),
  };
}

const S3_RETENTION_PLAN_EXPIRED_SLOTS_MESSAGE =
  "S3 retention response plan must include expiredSlots";
const S3_RETENTION_PLAN_RETIRED_OBJECTS_MESSAGE =
  "S3 retention response plan must include retiredObjects";
const S3_RETENTION_PLAN_CURSOR_MESSAGE =
  "S3 retention response plan cursor must be an object";
const S3_RETENTION_PLAN_EXPIRED_SLOTS_CONTEXT =
  "S3 retention response plan.expiredSlots";

function retentionPlanPayload(
  value: unknown
): StoredS3CoordinatorRetentionResponse["plan"] {
  if (!isRecord(value)) {
    throw new Error("S3 retention response plan must be an object");
  }

  const parsedExpiredSlots = retentionPlanExpiredSlotsPayload(value);

  const parsedRetiredObjects = retentionPlanRetiredObjectsPayload(value);

  const cursor = optionalRetentionPlanCursor(value);

  return {
    expiredSlots: parsedExpiredSlots,
    retiredObjects: parsedRetiredObjects,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function retentionPlanExpiredSlotsPayload(
  value: Record<string, unknown>
): S3RuntimeRetentionExpiredSlotsPayload {
  return requiredArrayField(
    value,
    "expiredSlots",
    S3_RETENTION_PLAN_EXPIRED_SLOTS_MESSAGE
  ).map((slot, index) => retentionExpiredSlotPayload(slot, index));
}

function retentionPlanRetiredObjectsPayload(
  value: Record<string, unknown>
): S3RuntimeRetentionRetiredObjectsPayload {
  return retentionRetiredObjectCollectionPayload(
    value,
    "retiredObjects",
    S3_RETENTION_PLAN_RETIRED_OBJECTS_MESSAGE,
    "S3 retention response plan.retiredObjects"
  );
}

function retentionExpiredSlotPayload(
  value: unknown,
  index: number
): UploadSlot {
  if (!isRecord(value)) {
    throw new Error(
      `${indexedFieldContext(S3_RETENTION_PLAN_EXPIRED_SLOTS_CONTEXT, index)} must be an object`
    );
  }

  try {
    return parseUploadSlot(value);
  } catch (error) {
    throw new Error(
      `${indexedFieldContext(S3_RETENTION_PLAN_EXPIRED_SLOTS_CONTEXT, index)} must be valid: ${errorMessage(error, String(error))}`,
      { cause: error }
    );
  }
}

function optionalRetentionPlanCursor(
  value: Record<string, unknown>
): Cursor | undefined {
  if (value.cursor === undefined) {
    return;
  }

  if (!isRecord(value.cursor)) {
    throw new Error(S3_RETENTION_PLAN_CURSOR_MESSAGE);
  }

  return parseCursor(value.cursor);
}

const S3_RETENTION_RESULT_ENVELOPE_MESSAGE =
  "S3 retention response must include result and summary";
const S3_RETENTION_RESULT_DELETED_OBJECTS_MESSAGE =
  "S3 retention response result must include deletedObjects";
const S3_RETENTION_RESULT_FAILED_OBJECTS_MESSAGE =
  "S3 retention response result must include failedObjects";
const S3_RETENTION_RESULT_FAILED_OBJECTS_CONTEXT =
  "S3 retention response result.failedObjects";

function retentionResultPayload(
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

function retentionRetiredObjectCollectionPayload(
  value: Record<string, unknown>,
  field: "deletedObjects" | "retiredObjects",
  message: string,
  context: string
): S3RuntimeRetiredObjectPayload[] {
  return requiredArrayField(value, field, message).map((entry, index) =>
    retiredObjectPayload(entry, indexedFieldContext(context, index))
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
  const context = indexedFieldContext(
    S3_RETENTION_RESULT_FAILED_OBJECTS_CONTEXT,
    index
  );
  const failure = requiredRecord(value, `${context} must be an object`);

  const object = retiredObjectPayload(failure.object, `${context}.object`);

  return {
    error: requiredStringField(
      failure,
      "error",
      `${context}.error must be set`
    ),
    object,
  };
}

const S3_RETENTION_SUMMARY_DELETED_MESSAGE =
  "S3 retention response summary must include deleted";
const S3_RETENTION_SUMMARY_FAILED_MESSAGE =
  "S3 retention response summary must include failed";
const S3_RETENTION_SUMMARY_PLANNED_MESSAGE =
  "S3 retention response summary must include planned";
const S3_RETENTION_SUMMARY_FAILED_OBJECT_KEYS_MESSAGE =
  "S3 retention response summary must include failedObjectKeys";
const S3_RETENTION_SUMMARY_FAILED_SLOT_IDS_MESSAGE =
  "S3 retention response summary must include failedSlotIds";
const S3_RETENTION_SUMMARY_OK_MESSAGE =
  "S3 retention response summary must include ok";

function retentionSummary(
  value: Record<string, unknown>
): StoredS3CoordinatorRetentionResponse["summary"] {
  const counts = retentionSummaryCounts(value);
  const arrays = retentionSummaryArrays(value);
  const ok = summaryOk(value, S3_RETENTION_SUMMARY_OK_MESSAGE);

  return {
    ...counts,
    ...arrays,
    ok,
  };
}

function retentionSummaryArrays(
  value: Record<string, unknown>
): S3RuntimeRetentionSummaryArrays {
  return {
    failedObjectKeys: requiredStringArrayField(
      value,
      "failedObjectKeys",
      S3_RETENTION_SUMMARY_FAILED_OBJECT_KEYS_MESSAGE
    ),
    failedSlotIds: requiredStringArrayField(
      value,
      "failedSlotIds",
      S3_RETENTION_SUMMARY_FAILED_SLOT_IDS_MESSAGE
    ),
  };
}

function retentionSummaryCounts(
  value: Record<string, unknown>
): S3RuntimeRetentionSummaryCounts {
  return summaryCounts(value, [
    { field: "deleted", message: S3_RETENTION_SUMMARY_DELETED_MESSAGE },
    { field: "failed", message: S3_RETENTION_SUMMARY_FAILED_MESSAGE },
    { field: "planned", message: S3_RETENTION_SUMMARY_PLANNED_MESSAGE },
  ]);
}
