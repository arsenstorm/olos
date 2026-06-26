import { requiredRecord, requiredRecordField } from "../runtime/http-client";
import type { S3RuntimeRetentionPayloadFields } from "./client-payload-types";
import { retentionPlanPayload } from "./client-retention-plan-payload";
import { retentionResultPayload } from "./client-retention-result-payload";
import { retentionSummary } from "./client-retention-summary-payload";
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
