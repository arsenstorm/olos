import {
  requiredArrayField,
  requiredRecord,
  requiredRecordField,
  requiredStringField,
} from "../runtime/http-client";
import { parseCommit } from "../validation/commit";
import { isAllowedString, isRecord } from "../validation/fields";
import {
  isOlosErrorCode,
  reconciliationSummaryPayload,
} from "./client-payload-reconciliation-summary";
import {
  indexedFieldContext,
  optionalCursorPayload,
} from "./client-payload-shared";
import type {
  S3RuntimeFailedReconciliationResultStatus,
  S3RuntimeReconciliationPayloadFields,
  S3RuntimeReconciliationResultPayload,
  S3RuntimeReconciliationResultStatus,
  S3RuntimeReconciliationResultsPayload,
  S3RuntimeSuccessfulReconciliationResultStatus,
} from "./client-payload-types";
import type {
  StoredS3CoordinatorReconciliationResponse,
  StoredS3CoordinatorRouteError,
} from "./http-types";

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
