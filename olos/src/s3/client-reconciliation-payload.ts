import {
  requiredArrayField,
  requiredRecord,
  requiredRecordField,
  requiredStringField,
} from "../runtime/http-client";
import { isStringLiteral } from "../runtime/string-literals";
import { assertCommit } from "../validation";
import type {
  S3RuntimeFailedReconciliationResultStatus,
  S3RuntimeOptionalCursorPayload,
  S3RuntimeReconciliationPayloadFields,
  S3RuntimeReconciliationResultPayload,
  S3RuntimeReconciliationResultStatus,
  S3RuntimeReconciliationResultsPayload,
  S3RuntimeSuccessfulReconciliationResultStatus,
} from "./client-payload-types";
import { reconciliationSummaryPayload } from "./client-reconciliation-summary-payload";
import { optionalCursorPayload } from "./client-upload-payload";
import type { StoredS3CoordinatorReconciliationResponse } from "./http-types";

const S3_RUNTIME_RECONCILIATION_RESULT_STATUSES = [
  "committed",
  "failed",
  "idempotent",
] as const satisfies readonly S3RuntimeReconciliationResultStatus[];
const S3_RECONCILIATION_RESPONSE_RESULTS_MESSAGE =
  "S3 reconciliation response must include results";
const S3_RECONCILIATION_RESPONSE_SUMMARY_MESSAGE =
  "S3 reconciliation response must include summary";

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
  const resultRecord = requiredRecord(
    value,
    reconciliationResultObjectContext(index)
  );
  const status = reconciliationResultStatus(resultRecord, index);
  const slotId = requiredStringField(
    resultRecord,
    "slotId",
    reconciliationResultSlotIdContext(index)
  );

  if (isSuccessfulReconciliationResultStatus(status)) {
    return successfulReconciliationResultPayload(
      resultRecord,
      index,
      slotId,
      status
    );
  }

  return failedReconciliationResultPayload(status, slotId);
}

function reconciliationResultStatus(
  value: Record<string, unknown>,
  index: number
): S3RuntimeReconciliationResultStatus {
  const status = requiredStringField(
    value,
    "status",
    `S3 reconciliation response results[${index}] must include status`
  );

  if (!isReconciliationResultStatus(status)) {
    throw new Error(reconciliationResultUnknownStatusContext(index));
  }

  return status;
}

function isReconciliationResultStatus(
  status: string
): status is S3RuntimeReconciliationResultStatus {
  return isStringLiteral(status, S3_RUNTIME_RECONCILIATION_RESULT_STATUSES);
}

function isSuccessfulReconciliationResultStatus(
  status: S3RuntimeReconciliationResultStatus
): status is S3RuntimeSuccessfulReconciliationResultStatus {
  return status === "committed" || status === "idempotent";
}

function successfulReconciliationResultPayload(
  value: Record<string, unknown>,
  index: number,
  slotId: string,
  status: S3RuntimeSuccessfulReconciliationResultStatus
): S3RuntimeReconciliationResultPayload {
  const commit = requiredRecordField(
    value,
    "commit",
    reconciliationResultCommitContext(index)
  );

  assertCommit(commit);

  return {
    commit,
    slotId,
    status,
    ...optionalReconciliationResultCursor(value),
  };
}

function optionalReconciliationResultCursor(
  value: Record<string, unknown>
): S3RuntimeOptionalCursorPayload {
  return optionalCursorPayload(value);
}

function failedReconciliationResultPayload(
  status: S3RuntimeFailedReconciliationResultStatus,
  slotId: string
): S3RuntimeReconciliationResultPayload {
  return { slotId, status };
}

function reconciliationResultObjectContext(index: number): string {
  return `S3 reconciliation response results[${index}] must be an object`;
}

function reconciliationResultSlotIdContext(index: number): string {
  return `S3 reconciliation response results[${index}] must include slotId`;
}

function reconciliationResultCommitContext(index: number): string {
  return `S3 reconciliation response results[${index}] must include commit`;
}

function reconciliationResultUnknownStatusContext(index: number): string {
  return `S3 reconciliation response results[${index}] status must be committed, idempotent, or failed`;
}
