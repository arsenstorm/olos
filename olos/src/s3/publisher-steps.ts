import type { RuntimePublisherHeartbeatResult } from "../runtime/publisher";
import type { OlosErrorCode } from "../types/errors";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import { errorMessage, isAllowedString } from "../validation/fields";
import type {
  StoredS3CoordinatorUploadCommit,
  StoredS3CoordinatorUploadGrantIssue,
} from "./coordinator-types";
import {
  type FailedStoredS3PublisherCommitStep,
  type FailedStoredS3PublisherIssueStep,
  type FailedStoredS3PublisherUploadObjectStep,
  type ReadyStoredS3PublisherHeartbeat,
  type RejectedStoredS3PublisherErrorCodeResult,
  type SavedStoredS3CoordinatorUploadGrantIssue,
  type StoredS3PublisherErrorCodeResult,
  type StoredS3PublisherUploadStep,
  SUCCESSFUL_STORED_S3_PUBLISHER_STEP_STATUSES,
  type SuccessfulStoredS3PublisherUploadStep,
} from "./publisher-types";
export function committedStoredS3PublisherUploadStep(
  committed: StoredS3CoordinatorUploadCommit,
  heartbeat: ReadyStoredS3PublisherHeartbeat,
  issued: SavedStoredS3CoordinatorUploadGrantIssue
): StoredS3PublisherUploadStep {
  return {
    commit: committed,
    grant: issued.grant,
    ...heartbeatResult(heartbeat),
    slot: issued.slot,
    status: isSuccessfulStoredS3PublisherStepStatus(committed.status)
      ? committed.status
      : "commit_failed",
  };
}

export function failedStoredS3PublisherIssueStep(
  error: unknown,
  heartbeat: RuntimePublisherHeartbeatResult | undefined
): FailedStoredS3PublisherIssueStep {
  return {
    error: errorMessage(error, "S3 publisher step failed"),
    ...heartbeatResult(heartbeat),
    status: "issue_failed",
  };
}

export function unissuedStoredS3PublisherIssueStep(
  issue: Exclude<StoredS3CoordinatorUploadGrantIssue, { status: "saved" }>,
  heartbeat: RuntimePublisherHeartbeatResult | undefined
): FailedStoredS3PublisherIssueStep {
  return {
    ...heartbeatResult(heartbeat),
    issue,
    status: "issue_failed",
  };
}

export function failedStoredS3PublisherUploadObjectStep(
  error: unknown,
  heartbeat: RuntimePublisherHeartbeatResult | undefined,
  grant: UploadGrant,
  slot: UploadSlot
): FailedStoredS3PublisherUploadObjectStep {
  return {
    error: errorMessage(error, "S3 publisher step failed"),
    grant,
    ...heartbeatResult(heartbeat),
    slot,
    status: "upload_failed",
  };
}

export function failedStoredS3PublisherCommitStep(
  error: unknown,
  heartbeat: RuntimePublisherHeartbeatResult | undefined,
  grant: UploadGrant,
  slot: UploadSlot
): FailedStoredS3PublisherCommitStep {
  return {
    error: errorMessage(error, "S3 publisher step failed"),
    grant,
    ...heartbeatResult(heartbeat),
    slot,
    status: "commit_failed",
  };
}

export function isSuccessfulStoredS3PublisherStepStatus(
  status: string
): status is SuccessfulStoredS3PublisherUploadStep["status"] {
  return isAllowedString(status, SUCCESSFUL_STORED_S3_PUBLISHER_STEP_STATUSES);
}

export function heartbeatResult(
  heartbeat: RuntimePublisherHeartbeatResult | undefined
): { heartbeat?: RuntimePublisherHeartbeatResult } {
  return heartbeat === undefined ? {} : { heartbeat };
}

export function resultErrorCode(
  result?: StoredS3PublisherErrorCodeResult
): OlosErrorCode | undefined {
  return isRejectedStoredS3PublisherErrorCodeResult(result)
    ? result.error.error.code
    : undefined;
}

export function isRejectedStoredS3PublisherErrorCodeResult(
  result: StoredS3PublisherErrorCodeResult | undefined
): result is RejectedStoredS3PublisherErrorCodeResult {
  return result?.status === "rejected";
}
