import { OLOS_ERROR_CODES } from "../config/errors";
import {
  optionalParsedPayload,
  requiredArrayField,
  requiredRecord,
  requiredRecordField,
  requiredStringField,
} from "../runtime/http-client";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { OlosErrorCode } from "../types/errors";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import { parseCommit } from "../validation/commit";
import { parseCursor } from "../validation/cursor";
import { errorMessage, isAllowedString, isRecord } from "../validation/fields";
import { parseUploadGrant } from "../validation/upload-grant";
import { parseUploadSlot } from "../validation/upload-slot";
import type {
  S3RuntimeCommitPayloadFields,
  S3RuntimeFailedReconciliationResultStatus,
  S3RuntimeGrantPayloadFields,
  S3RuntimeOptionalCursorPayload,
  S3RuntimeReconciliationPayloadFields,
  S3RuntimeReconciliationPlanStatus,
  S3RuntimeReconciliationResultPayload,
  S3RuntimeReconciliationResultStatus,
  S3RuntimeReconciliationResultsPayload,
  S3RuntimeReconciliationSummaryArrays,
  S3RuntimeReconciliationSummaryCounts,
  S3RuntimeReconciliationSummaryOk,
  S3RuntimeReconciliationSummaryStatus,
  S3RuntimeRetentionDeletedObjectsPayload,
  S3RuntimeRetentionExpiredSlotsPayload,
  S3RuntimeRetentionFailedObjectPayload,
  S3RuntimeRetentionPayloadFields,
  S3RuntimeRetentionRetiredObjectsPayload,
  S3RuntimeRetentionSummaryArrays,
  S3RuntimeRetentionSummaryCounts,
  S3RuntimeRetentionSummaryOk,
  S3RuntimeRetiredObjectPayload,
  S3RuntimeSuccessfulReconciliationResultStatus,
  S3RuntimeSummaryCountField,
} from "./client-payload-types";
import type {
  S3RuntimeCompleteUploadResponse,
  S3RuntimeIssueUploadGrantResponse,
} from "./client-types";
import type {
  StoredS3CoordinatorReconciliationResponse,
  StoredS3CoordinatorRetentionResponse,
  StoredS3CoordinatorRouteError,
} from "./http-types";
import type { StoredS3CoordinatorReconciliationPlan } from "./reconciliation";

function indexedFieldContext(context: string, index: number): string {
  return `${context}[${index}]`;
}

// --- upload payloads ---

const S3_UPLOAD_GRANT_RESPONSE_FIELDS_MESSAGE =
  "S3 upload grant response must include grant and slot";
const S3_UPLOAD_COMMIT_RESPONSE_FIELDS_MESSAGE =
  "S3 upload completion response must include a commit";

export function grantPayload(
  value: unknown
): Omit<S3RuntimeIssueUploadGrantResponse, "response"> {
  const fields = grantPayloadFields(value);

  return {
    grant: uploadGrantPayload(fields.grant),
    slot: uploadSlotPayload(fields.slot),
  };
}

function uploadGrantPayload(value: Record<string, unknown>): UploadGrant {
  return parseUploadGrant(value);
}

function uploadSlotPayload(value: Record<string, unknown>): UploadSlot {
  return parseUploadSlot(value);
}

function grantPayloadFields(value: unknown): S3RuntimeGrantPayloadFields {
  return {
    grant: requiredRecordField(
      value,
      "grant",
      S3_UPLOAD_GRANT_RESPONSE_FIELDS_MESSAGE
    ),
    slot: requiredRecordField(
      value,
      "slot",
      S3_UPLOAD_GRANT_RESPONSE_FIELDS_MESSAGE
    ),
  };
}

export function commitPayload(
  value: unknown
): Omit<S3RuntimeCompleteUploadResponse, "response"> {
  const fields = commitPayloadFields(value);

  return {
    commit: commitResponsePayload(fields.commit),
    ...optionalCursorPayload(value),
  };
}

function commitResponsePayload(value: Record<string, unknown>): Commit {
  return parseCommit(value);
}

function commitPayloadFields(value: unknown): S3RuntimeCommitPayloadFields {
  return {
    commit: requiredRecordField(
      value,
      "commit",
      S3_UPLOAD_COMMIT_RESPONSE_FIELDS_MESSAGE
    ),
  };
}

function optionalCursorPayload(value: unknown): S3RuntimeOptionalCursorPayload {
  return optionalParsedPayload<"cursor", Cursor>(value, "cursor", parseCursor);
}

// --- shared summary payloads ---

function summaryCounts<const Field extends string>(
  value: Record<string, unknown>,
  fields: readonly S3RuntimeSummaryCountField<Field>[]
): Record<Field, number> {
  return Object.fromEntries(
    fields.map(({ field, message }) => [
      field,
      requiredSummaryNumber(value, field, message),
    ])
  ) as Record<Field, number>;
}

function summaryOk(value: Record<string, unknown>, message: string): boolean {
  return requiredSummaryBoolean(value, "ok", message);
}

function requiredStringArrayField(
  value: Record<string, unknown>,
  field: string,
  message: string
): readonly string[] {
  const values = requiredArrayField(value, field, message);

  for (const [index, item] of values.entries()) {
    if (typeof item !== "string") {
      throw new Error(requiredStringArrayItemMessage(message, index));
    }
  }

  return values as readonly string[];
}

function retiredObjectPayload(
  value: unknown,
  context: string
): S3RuntimeRetiredObjectPayload {
  const retired = requiredRecord(value, `${context} must be an object`);

  return {
    commitId: retiredObjectStringField(retired, "commitId", context),
    objectKey: retiredObjectStringField(retired, "objectKey", context),
    slotId: retiredObjectStringField(retired, "slotId", context),
  };
}

function retiredObjectStringField(
  value: Record<string, unknown>,
  field: keyof S3RuntimeRetiredObjectPayload,
  context: string
): string {
  return requiredStringField(value, field, `${context}.${field} must be set`);
}

function requiredSummaryBoolean(
  value: Record<string, unknown>,
  field: string,
  message: string
): boolean {
  if (typeof value[field] !== "boolean") {
    throw new Error(message);
  }

  return value[field];
}

function requiredSummaryNumber(
  value: Record<string, unknown>,
  field: string,
  message: string
): number {
  if (typeof value[field] !== "number") {
    throw new Error(message);
  }

  return value[field];
}

function requiredStringArrayItemMessage(
  message: string,
  index: number
): string {
  return `${indexedFieldContext(message, index)} must be a string`;
}

// --- retention payloads ---

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

// --- retention plan payloads ---

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
      `${indexedFieldContext(S3_RETENTION_PLAN_EXPIRED_SLOTS_CONTEXT, index)} must be valid: ${errorMessage(error, String(error))}`
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

// --- retention result payloads ---

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

// --- retention summary payloads ---

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
  const ok = retentionSummaryOk(value);

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

function retentionSummaryOk(
  value: Record<string, unknown>
): S3RuntimeRetentionSummaryOk {
  return summaryOk(value, S3_RETENTION_SUMMARY_OK_MESSAGE);
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

// --- reconciliation payloads ---

const S3_RUNTIME_RECONCILIATION_RESULT_STATUSES = [
  "committed",
  "failed",
  "idempotent",
] as const satisfies readonly S3RuntimeReconciliationResultStatus[];
const S3_RECONCILIATION_RESPONSE_RESULTS_MESSAGE =
  "S3 reconciliation response must include results";
const S3_RECONCILIATION_RESPONSE_SUMMARY_MESSAGE =
  "S3 reconciliation response must include summary";
const S3_RECONCILIATION_RESULTS_CONTEXT = "S3 reconciliation response results";

export function reconciliationPayload(
  value: unknown
): StoredS3CoordinatorReconciliationResponse {
  const record = requiredRecord(
    value,
    S3_RECONCILIATION_RESPONSE_RESULTS_MESSAGE
  );

  const fields = reconciliationPayloadFields(record);

  return {
    results: reconciliationResultsCollectionPayload(fields),
    summary: reconciliationSummaryPayload(fields.summary),
  };
}

function reconciliationPayloadFields(
  value: Record<string, unknown>
): S3RuntimeReconciliationPayloadFields {
  return {
    results: value.results,
    summary: requiredRecordField(
      value,
      "summary",
      S3_RECONCILIATION_RESPONSE_SUMMARY_MESSAGE
    ),
  };
}

function reconciliationResultsCollectionPayload(
  value: S3RuntimeReconciliationPayloadFields
): S3RuntimeReconciliationResultsPayload {
  const results = requiredArrayField(
    value,
    "results",
    S3_RECONCILIATION_RESPONSE_RESULTS_MESSAGE
  );

  return results.map((result, index) =>
    reconciliationResultPayload(result, index)
  );
}

function reconciliationResultPayload(
  value: unknown,
  index: number
): S3RuntimeReconciliationResultPayload {
  const context = indexedFieldContext(S3_RECONCILIATION_RESULTS_CONTEXT, index);
  const resultRecord = requiredRecord(value, `${context} must be an object`);
  const status = reconciliationResultStatus(resultRecord, context);
  const slotId = requiredStringField(
    resultRecord,
    "slotId",
    `${context} must include slotId`
  );

  if (isSuccessfulReconciliationResultStatus(status)) {
    return successfulReconciliationResultPayload(
      resultRecord,
      context,
      slotId,
      status
    );
  }

  return failedReconciliationResultPayload(
    resultRecord,
    context,
    slotId,
    status
  );
}

function reconciliationResultStatus(
  value: Record<string, unknown>,
  context: string
): S3RuntimeReconciliationResultStatus {
  const status = requiredStringField(
    value,
    "status",
    `${context} must include status`
  );

  if (!isReconciliationResultStatus(status)) {
    throw new Error(
      `${context} status must be committed, idempotent, or failed`
    );
  }

  return status;
}

function isReconciliationResultStatus(
  status: string
): status is S3RuntimeReconciliationResultStatus {
  return isAllowedString(status, S3_RUNTIME_RECONCILIATION_RESULT_STATUSES);
}

function isSuccessfulReconciliationResultStatus(
  status: S3RuntimeReconciliationResultStatus
): status is S3RuntimeSuccessfulReconciliationResultStatus {
  return status === "committed" || status === "idempotent";
}

function successfulReconciliationResultPayload(
  value: Record<string, unknown>,
  context: string,
  slotId: string,
  status: S3RuntimeSuccessfulReconciliationResultStatus
): S3RuntimeReconciliationResultPayload {
  const commit = parseCommit(
    requiredRecordField(value, "commit", `${context} must include commit`)
  );

  return {
    commit,
    slotId,
    status,
    ...optionalCursorPayload(value),
  };
}

function failedReconciliationResultPayload(
  value: Record<string, unknown>,
  context: string,
  slotId: string,
  status: S3RuntimeFailedReconciliationResultStatus
): S3RuntimeReconciliationResultPayload {
  return {
    slotId,
    status,
    ...failedReconciliationErrorPayload(value, context),
    ...failedReconciliationResultStatusPayload(value, context),
  };
}

// The server attaches per-slot failure details (`error`, `resultStatus`)
// when it can; surface them to the client instead of dropping them.
function failedReconciliationErrorPayload(
  value: Record<string, unknown>,
  context: string
): Partial<{ error: StoredS3CoordinatorRouteError }> {
  if (value.error === undefined) {
    return {};
  }

  const error = requiredRecord(
    value.error,
    `${context}.error must be an object`
  );
  const code = requiredStringField(
    error,
    "code",
    `${context}.error must include code`
  );

  if (!isOlosErrorCode(code)) {
    throw new Error(`${context}.error.code must be an OLOS error code`);
  }

  return {
    error: {
      code,
      message: requiredStringField(
        error,
        "message",
        `${context}.error must include message`
      ),
      ...failedReconciliationErrorDetailsPayload(error, context),
    },
  };
}

function failedReconciliationErrorDetailsPayload(
  error: Record<string, unknown>,
  context: string
): Partial<{ details: Record<string, unknown> }> {
  if (error.details === undefined) {
    return {};
  }

  if (!isRecord(error.details)) {
    throw new Error(`${context}.error.details must be an object`);
  }

  return { details: error.details };
}

function failedReconciliationResultStatusPayload(
  value: Record<string, unknown>,
  context: string
): Partial<{ resultStatus: string }> {
  if (value.resultStatus === undefined) {
    return {};
  }

  return {
    resultStatus: requiredStringField(
      value,
      "resultStatus",
      `${context}.resultStatus must be a string`
    ),
  };
}

// --- reconciliation plan payloads ---

const S3_RECONCILIATION_PLAN_RESPONSE_STATUS_MESSAGE =
  "S3 reconciliation plan response must include status";
const S3_RECONCILIATION_PLAN_RESPONSE_SLOT_IDS_MESSAGE =
  "S3 reconciliation plan response must include planned slotIds";
const S3_RECONCILIATION_PLAN_RESPONSE_SLOTS_MESSAGE =
  "S3 reconciliation plan response must include planned slots";
const S3_RECONCILIATION_PLAN_STATUS_MESSAGE =
  "S3 reconciliation plan response status must be planned or not_found";
const S3_RUNTIME_RECONCILIATION_PLAN_STATUSES = [
  "planned",
  "not_found",
] as const satisfies readonly S3RuntimeReconciliationPlanStatus[];
const S3_RECONCILIATION_PLAN_SLOT_IDS_CONTEXT =
  "S3 reconciliation plan slotIds";
const S3_RECONCILIATION_PLAN_SLOTS_CONTEXT = "S3 reconciliation plan slots";

export function reconciliationPlanPayload(
  value: unknown
): StoredS3CoordinatorReconciliationPlan {
  const record = requiredRecord(
    value,
    S3_RECONCILIATION_PLAN_RESPONSE_STATUS_MESSAGE
  );
  const status = reconciliationPlanStatus(record);

  if (status === "not_found") {
    return missingReconciliationPlanPayload();
  }

  return plannedReconciliationPlanPayload(record);
}

function missingReconciliationPlanPayload(): StoredS3CoordinatorReconciliationPlan {
  return { status: "not_found" };
}

function plannedReconciliationPlanPayload(
  value: Record<string, unknown>
): StoredS3CoordinatorReconciliationPlan {
  return {
    status: "planned",
    slotIds: reconciliationPlanSlotIds(value),
    slots: reconciliationPlanSlots(value),
  };
}

function reconciliationPlanStatus(
  value: Record<string, unknown>
): S3RuntimeReconciliationPlanStatus {
  const status = requiredStringField(
    value,
    "status",
    S3_RECONCILIATION_PLAN_RESPONSE_STATUS_MESSAGE
  );

  if (!isReconciliationPlanStatus(status)) {
    throw new Error(S3_RECONCILIATION_PLAN_STATUS_MESSAGE);
  }

  return status;
}

function isReconciliationPlanStatus(
  status: string
): status is S3RuntimeReconciliationPlanStatus {
  return isAllowedString(status, S3_RUNTIME_RECONCILIATION_PLAN_STATUSES);
}

function reconciliationPlanSlotIds(
  value: Record<string, unknown>
): readonly string[] {
  const slotIds = requiredArrayField(
    value,
    "slotIds",
    S3_RECONCILIATION_PLAN_RESPONSE_SLOT_IDS_MESSAGE
  );

  return slotIds.map((slotId, index) => {
    if (typeof slotId !== "string") {
      throw new Error(
        `${indexedFieldContext(S3_RECONCILIATION_PLAN_SLOT_IDS_CONTEXT, index)} must be a string`
      );
    }

    return slotId;
  });
}

function reconciliationPlanSlots(
  value: Record<string, unknown>
): readonly UploadSlot[] {
  const slots = requiredArrayField(
    value,
    "slots",
    S3_RECONCILIATION_PLAN_RESPONSE_SLOTS_MESSAGE
  );

  return slots.map((slot, index) => {
    try {
      return parseUploadSlot(slot);
    } catch (error) {
      throw new Error(
        `${indexedFieldContext(S3_RECONCILIATION_PLAN_SLOTS_CONTEXT, index)} must be valid: ${errorMessage(error, String(error))}`
      );
    }
  });
}

// --- reconciliation summary payloads ---

const S3_RECONCILIATION_SUMMARY_COMMITTED_MESSAGE =
  "S3 reconciliation response summary must include committed";
const S3_RECONCILIATION_SUMMARY_FAILED_MESSAGE =
  "S3 reconciliation response summary must include failed";
const S3_RECONCILIATION_SUMMARY_IDEMPOTENT_MESSAGE =
  "S3 reconciliation response summary must include idempotent";
const S3_RECONCILIATION_SUMMARY_PLANNED_MESSAGE =
  "S3 reconciliation response summary must include planned";
const S3_RECONCILIATION_SUMMARY_STATUS_MESSAGE =
  "S3 reconciliation response summary must include status";
const S3_RECONCILIATION_SUMMARY_STATUS_VALUE_MESSAGE =
  "S3 reconciliation response summary status must be reconciled";
const S3_RECONCILIATION_SUMMARY_STATUS_VALUE = "reconciled";
const S3_RECONCILIATION_SUMMARY_FAILED_ERROR_CODES_MESSAGE =
  "S3 reconciliation response summary must include failedErrorCodes";
const S3_RECONCILIATION_SUMMARY_FAILED_SLOT_IDS_MESSAGE =
  "S3 reconciliation response summary must include failedSlotIds";
const S3_RECONCILIATION_SUMMARY_SLOT_IDS_MESSAGE =
  "S3 reconciliation response summary must include slotIds";
const S3_RECONCILIATION_SUMMARY_OK_MESSAGE =
  "S3 reconciliation response summary must include ok";

function reconciliationSummaryPayload(
  value: Record<string, unknown>
): StoredS3CoordinatorReconciliationResponse["summary"] {
  const counts = reconciliationSummaryCounts(value);
  const status = reconciliationSummaryStatus(value);
  const arrays = reconciliationSummaryArrays(value);
  const ok = reconciliationSummaryOk(value);

  return {
    ...counts,
    ...arrays,
    ok,
    status,
  };
}

function reconciliationSummaryCounts(
  value: Record<string, unknown>
): S3RuntimeReconciliationSummaryCounts {
  return summaryCounts(value, [
    {
      field: "committed",
      message: S3_RECONCILIATION_SUMMARY_COMMITTED_MESSAGE,
    },
    { field: "failed", message: S3_RECONCILIATION_SUMMARY_FAILED_MESSAGE },
    {
      field: "idempotent",
      message: S3_RECONCILIATION_SUMMARY_IDEMPOTENT_MESSAGE,
    },
    { field: "planned", message: S3_RECONCILIATION_SUMMARY_PLANNED_MESSAGE },
  ]);
}

function reconciliationSummaryStatus(
  value: Record<string, unknown>
): S3RuntimeReconciliationSummaryStatus {
  const status = requiredStringField(
    value,
    "status",
    S3_RECONCILIATION_SUMMARY_STATUS_MESSAGE
  );

  if (status !== S3_RECONCILIATION_SUMMARY_STATUS_VALUE) {
    throw new Error(S3_RECONCILIATION_SUMMARY_STATUS_VALUE_MESSAGE);
  }

  return status;
}

function reconciliationSummaryErrorCodes(
  value: Record<string, unknown>
): readonly OlosErrorCode[] {
  const codes = requiredStringArrayField(
    value,
    "failedErrorCodes",
    S3_RECONCILIATION_SUMMARY_FAILED_ERROR_CODES_MESSAGE
  );
  const parsed: OlosErrorCode[] = [];

  for (const [index, code] of codes.entries()) {
    if (!isOlosErrorCode(code)) {
      throw new Error(
        `${indexedFieldContext(S3_RECONCILIATION_SUMMARY_FAILED_ERROR_CODES_MESSAGE, index)} must be an OLOS error code`
      );
    }

    parsed.push(code);
  }

  return parsed;
}

function isOlosErrorCode(value: string): value is OlosErrorCode {
  return isAllowedString(value, OLOS_ERROR_CODES);
}

function reconciliationSummaryArrays(
  value: Record<string, unknown>
): S3RuntimeReconciliationSummaryArrays {
  return {
    failedErrorCodes: reconciliationSummaryErrorCodes(value),
    failedSlotIds: requiredStringArrayField(
      value,
      "failedSlotIds",
      S3_RECONCILIATION_SUMMARY_FAILED_SLOT_IDS_MESSAGE
    ),
    slotIds: requiredStringArrayField(
      value,
      "slotIds",
      S3_RECONCILIATION_SUMMARY_SLOT_IDS_MESSAGE
    ),
  };
}

function reconciliationSummaryOk(
  value: Record<string, unknown>
): S3RuntimeReconciliationSummaryOk {
  return summaryOk(value, S3_RECONCILIATION_SUMMARY_OK_MESSAGE);
}
