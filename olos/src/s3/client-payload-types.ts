import type { Cursor } from "../types/cursor";
import type {
  StoredS3CoordinatorReconciliationResponse,
  StoredS3CoordinatorRetentionResponse,
} from "./http-types";
import type { StoredS3CoordinatorReconciliationPlan } from "./reconciliation";

export type S3RuntimeReconciliationResultPayload =
  StoredS3CoordinatorReconciliationResponse["results"][number];

export type S3RuntimeReconciliationResultStatus =
  | "committed"
  | "failed"
  | "idempotent";

export type S3RuntimeSuccessfulReconciliationResultStatus =
  | "committed"
  | "idempotent";

export type S3RuntimeFailedReconciliationResultStatus = Exclude<
  S3RuntimeReconciliationResultStatus,
  S3RuntimeSuccessfulReconciliationResultStatus
>;

export interface S3RuntimeCommitPayloadFields {
  commit: Record<string, unknown>;
}

export interface S3RuntimeGrantPayloadFields {
  grant: Record<string, unknown>;
  slot: Record<string, unknown>;
}

export interface S3RuntimeReconciliationPayloadFields {
  results: unknown;
  summary: Record<string, unknown>;
}

export type S3RuntimeReconciliationResultsPayload =
  StoredS3CoordinatorReconciliationResponse["results"];

export type S3RuntimeReconciliationPlanStatus =
  StoredS3CoordinatorReconciliationPlan["status"];

export interface S3RuntimeRetentionPayloadFields {
  plan: Record<string, unknown>;
  result: Record<string, unknown>;
  summary: Record<string, unknown>;
}

export type S3RuntimeReconciliationSummaryArrays = Pick<
  StoredS3CoordinatorReconciliationResponse["summary"],
  "failedErrorCodes" | "failedSlotIds" | "slotIds"
>;

export type S3RuntimeReconciliationSummaryCounts = Pick<
  StoredS3CoordinatorReconciliationResponse["summary"],
  "committed" | "failed" | "idempotent" | "planned"
>;

export type S3RuntimeReconciliationSummaryStatus =
  StoredS3CoordinatorReconciliationResponse["summary"]["status"];

export type S3RuntimeReconciliationSummaryOk =
  StoredS3CoordinatorReconciliationResponse["summary"]["ok"];

export type S3RuntimeRetentionSummaryArrays = Pick<
  StoredS3CoordinatorRetentionResponse["summary"],
  "failedObjectKeys" | "failedSlotIds"
>;

export type S3RuntimeRetentionSummaryCounts = Pick<
  StoredS3CoordinatorRetentionResponse["summary"],
  "deleted" | "failed" | "planned"
>;

export type S3RuntimeRetentionSummaryOk =
  StoredS3CoordinatorRetentionResponse["summary"]["ok"];

export interface S3RuntimeSummaryCountField<Field extends string> {
  field: Field;
  message: string;
}

export interface S3RuntimeRetiredObjectPayload {
  commitId: string;
  objectKey: string;
  slotId: string;
}

export type S3RuntimeRetentionDeletedObjectsPayload =
  StoredS3CoordinatorRetentionResponse["result"]["deletedObjects"];

export type S3RuntimeRetentionExpiredSlotsPayload =
  StoredS3CoordinatorRetentionResponse["plan"]["expiredSlots"];

export type S3RuntimeRetentionFailedObjectPayload =
  StoredS3CoordinatorRetentionResponse["result"]["failedObjects"][number];

export type S3RuntimeRetentionRetiredObjectsPayload =
  StoredS3CoordinatorRetentionResponse["plan"]["retiredObjects"];

export type S3RuntimeOptionalCursorPayload = Partial<Record<"cursor", Cursor>>;
