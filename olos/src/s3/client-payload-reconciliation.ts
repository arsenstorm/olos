import {
  requiredArrayField,
  requiredRecord,
  requiredRecordField,
  requiredStringField,
} from "../runtime/http-client";
import { parseCommit } from "../validation/commit";
import { isAllowedString, isRecord } from "../validation/fields";
import {
  indexedFieldContext,
  optionalCursorPayload,
  requiredStringArrayField,
  summaryCounts,
  summaryOk,
} from "./client-payload-shared";
import type {
  S3RuntimeFailedReconciliationResultStatus,
  S3RuntimeReconciliationErrorPayload,
  S3RuntimeReconciliationPayloadFields,
  S3RuntimeReconciliationResponsePayload,
  S3RuntimeReconciliationResultPayload,
  S3RuntimeReconciliationResultStatus,
  S3RuntimeReconciliationResultsPayload,
  S3RuntimeReconciliationSummaryArrays,
  S3RuntimeReconciliationSummaryCounts,
  S3RuntimeReconciliationSummaryOk,
  S3RuntimeReconciliationSummaryPayload,
  S3RuntimeReconciliationSummaryStatus,
  S3RuntimeSuccessfulReconciliationResultStatus,
} from "./client-payload-types";

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
): S3RuntimeReconciliationResponsePayload {
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
// Spec §11.3: consumers MUST tolerate unknown `error.code` values, so any
// non-empty string the server sends is accepted rather than rejected.
function failedReconciliationErrorPayload(
  value: Record<string, unknown>,
  context: string
): Partial<{ error: S3RuntimeReconciliationErrorPayload }> {
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
): S3RuntimeReconciliationSummaryPayload {
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

function reconciliationSummaryArrays(
  value: Record<string, unknown>
): S3RuntimeReconciliationSummaryArrays {
  return {
    // Spec §11.3: consumers MUST tolerate unknown `error.code` values.
    failedErrorCodes: requiredStringArrayField(
      value,
      "failedErrorCodes",
      S3_RECONCILIATION_SUMMARY_FAILED_ERROR_CODES_MESSAGE
    ),
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
