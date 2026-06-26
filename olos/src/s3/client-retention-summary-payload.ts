import type {
  S3RuntimeRetentionSummaryArrays,
  S3RuntimeRetentionSummaryCounts,
  S3RuntimeRetentionSummaryOk,
} from "./client-payload-types";
import {
  requiredStringArrayField,
  summaryCounts,
  summaryOk,
} from "./client-summary-payload";
import type { StoredS3CoordinatorRetentionResponse } from "./http-types";

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

export function retentionSummary(
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
