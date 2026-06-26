import { OLOS_ERROR_CODES } from "../config/errors";
import { requiredStringField } from "../runtime/http-client";
import { isStringLiteral } from "../runtime/string-literals";
import type { OlosErrorCode } from "../types/errors";
import type {
  S3RuntimeReconciliationSummaryArrays,
  S3RuntimeReconciliationSummaryCounts,
  S3RuntimeReconciliationSummaryOk,
  S3RuntimeReconciliationSummaryStatus,
} from "./client-payload-types";
import {
  requiredStringArrayField,
  summaryCounts,
  summaryOk,
} from "./client-summary-payload";
import type { StoredS3CoordinatorReconciliationResponse } from "./http-types";

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

export function reconciliationSummaryPayload(
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
      throw new Error(reconciliationSummaryErrorCodeContext(index));
    }

    parsed.push(code);
  }

  return parsed;
}

function isOlosErrorCode(value: string): value is OlosErrorCode {
  return isStringLiteral(value, OLOS_ERROR_CODES);
}

function reconciliationSummaryErrorCodeContext(index: number): string {
  return `${S3_RECONCILIATION_SUMMARY_FAILED_ERROR_CODES_MESSAGE}[${index}] must be an OLOS error code`;
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
