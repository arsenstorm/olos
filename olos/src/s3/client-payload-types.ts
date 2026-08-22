import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type {
  StoredS3CoordinatorReconciliationResponse,
  StoredS3CoordinatorRetentionResponse,
} from "./http-types";
import type { StoredS3CoordinatorReconciliationPlan } from "./reconciliation";

/**
 * Reconciliation failure detail as parsed by the client: `code` is widened
 * to `string` because consumers MUST tolerate unknown `error.code` values
 * (Spec §11.3) rather than reject a response the server considers valid.
 */
export interface S3RuntimeReconciliationErrorPayload {
  code: string;
  details?: Record<string, unknown>;
  message: string;
}

export type S3RuntimeReconciliationResultPayload =
  | {
      commit: Commit;
      cursor?: Cursor;
      slotId: string;
      status: "committed" | "idempotent";
    }
  | {
      error?: S3RuntimeReconciliationErrorPayload;
      resultStatus?: string;
      slotId: string;
      status: "failed";
    };

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

export interface S3RuntimeReconciliationPayloadFields {
  results: unknown;
  summary: Record<string, unknown>;
}

export type S3RuntimeReconciliationResultsPayload =
  readonly S3RuntimeReconciliationResultPayload[];

export type S3RuntimeReconciliationPlanStatus =
  StoredS3CoordinatorReconciliationPlan["status"];

export interface S3RuntimeRetentionPayloadFields {
  plan: Record<string, unknown>;
  result: Record<string, unknown>;
  summary: Record<string, unknown>;
}

/** `failedErrorCodes` is widened to `string[]` for the same reason as
 * {@link S3RuntimeReconciliationErrorPayload.code}. */
export interface S3RuntimeReconciliationSummaryArrays {
  failedErrorCodes: readonly string[];
  failedSlotIds: readonly string[];
  slotIds: readonly string[];
}

export type S3RuntimeReconciliationSummaryCounts = Pick<
  StoredS3CoordinatorReconciliationResponse["summary"],
  "committed" | "failed" | "idempotent" | "planned"
>;

export type S3RuntimeReconciliationSummaryStatus =
  StoredS3CoordinatorReconciliationResponse["summary"]["status"];

export type S3RuntimeReconciliationSummaryOk =
  StoredS3CoordinatorReconciliationResponse["summary"]["ok"];

export interface S3RuntimeReconciliationSummaryPayload
  extends S3RuntimeReconciliationSummaryCounts,
    S3RuntimeReconciliationSummaryArrays {
  ok: S3RuntimeReconciliationSummaryOk;
  status: S3RuntimeReconciliationSummaryStatus;
}

/** Parsed shape of {@link import("./client-payload-reconciliation").reconciliationPayload}. */
export interface S3RuntimeReconciliationResponsePayload {
  results: S3RuntimeReconciliationResultsPayload;
  summary: S3RuntimeReconciliationSummaryPayload;
}

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
