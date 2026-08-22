import type { RuntimePublisherHeartbeatResult } from "../runtime/publisher";
import type { OlosErrorCode } from "../types/errors";
import type { UploadSlot } from "../types/upload-slot";
import type {
  StoredS3CoordinatorUploadCommit,
  StoredS3CoordinatorUploadGrantIssue,
} from "./coordinator-types";
import {
  isSuccessfulStoredS3PublisherStepStatus,
  resultErrorCode,
} from "./publisher-steps";
import type {
  StoredS3PublisherUploadStep,
  StoredS3PublisherUploadStepSummary,
} from "./publisher-types";
/**
 * Flatten a publisher step into a compact summary for logs and metrics,
 * extracting the slot/commit identifiers, per-phase statuses, and any error
 * message or `olos.*` rejection code.
 */
export function summarizeStoredS3PublisherUploadStep(
  step: StoredS3PublisherUploadStep
): StoredS3PublisherUploadStepSummary {
  const slot = "slot" in step ? step.slot : undefined;
  const commit = "commit" in step ? step.commit : undefined;
  const heartbeat = "heartbeat" in step ? step.heartbeat : undefined;
  const issue = "issue" in step ? step.issue : undefined;
  const error = "error" in step ? step.error : undefined;
  const errorCode = resultErrorCode(commit) ?? resultErrorCode(issue);

  return {
    ...commitSummaryFields(commit),
    ...errorSummaryFields(error, errorCode),
    ...heartbeatSummaryFields(heartbeat),
    ...issueSummaryFields(issue),
    ok: isSuccessfulStoredS3PublisherStepStatus(step.status),
    ...slotSummaryFields(slot),
    status: step.status,
  };
}

function commitSummaryFields(
  commit: StoredS3CoordinatorUploadCommit | undefined
): Pick<StoredS3PublisherUploadStepSummary, "commitId" | "commitStatus"> {
  if (commit === undefined) {
    return {};
  }

  return {
    ...("commit" in commit ? { commitId: commit.commit.commitId } : {}),
    commitStatus: commit.status,
  };
}

function errorSummaryFields(
  error: string | undefined,
  errorCode: OlosErrorCode | undefined
): Pick<StoredS3PublisherUploadStepSummary, "error" | "errorCode"> {
  return {
    ...(error === undefined ? {} : { error }),
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

function heartbeatSummaryFields(
  heartbeat: RuntimePublisherHeartbeatResult | undefined
): Pick<StoredS3PublisherUploadStepSummary, "heartbeatStatus"> {
  return heartbeat === undefined ? {} : { heartbeatStatus: heartbeat.status };
}

function issueSummaryFields(
  issue:
    | Exclude<StoredS3CoordinatorUploadGrantIssue, { status: "saved" }>
    | undefined
): Pick<StoredS3PublisherUploadStepSummary, "issueStatus"> {
  return issue === undefined ? {} : { issueStatus: issue.status };
}

function slotSummaryFields(
  slot: UploadSlot | undefined
): Pick<StoredS3PublisherUploadStepSummary, "objectKey" | "slotId"> {
  if (slot === undefined) {
    return {};
  }

  return {
    objectKey: slot.objectKey,
    slotId: slot.slotId,
  };
}
