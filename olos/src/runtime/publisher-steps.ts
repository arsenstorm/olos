import type { UploadSlot } from "../types/upload-slot";
import { errorMessage, isAllowedString } from "../validation/fields";
import type {
  RuntimeCommitPayload,
  RuntimeObservedUploadPayload,
} from "./commit";
import type {
  FailedRuntimePublisherCommitStep,
  FailedRuntimePublisherHeartbeatStep,
  FailedRuntimePublisherIssueStep,
  FailedRuntimePublisherUploadObjectStep,
  IssuedRuntimePublisherIssueResult,
  ResolveRuntimePublisherLoopDecisionOptions,
  RunRuntimePublisherUploadStepOptions,
  RuntimePublisherCommitPhaseResult,
  RuntimePublisherCommitResult,
  RuntimePublisherHeartbeatResult,
  RuntimePublisherIssuePhaseResult,
  RuntimePublisherIssueResult,
  RuntimePublisherLoopDecision,
  RuntimePublisherUploadObjectPhaseResult,
  RuntimePublisherUploadStepStatus,
  SuccessfulRuntimePublisherUploadStep,
} from "./publisher";
import {
  nonNegativeSafeInteger,
  optionalField,
  positiveSafeInteger,
} from "./request-fields";

export const PUBLISHER_STEP_STATUSES = [
  "committed",
  "idempotent",
  "heartbeat_failed",
  "issue_failed",
  "upload_failed",
  "commit_failed",
] as const satisfies readonly RuntimePublisherUploadStepStatus[];

export const SUCCESSFUL_PUBLISHER_STEP_STATUSES = [
  "committed",
  "idempotent",
] as const satisfies readonly SuccessfulRuntimePublisherUploadStep["status"][];

export function runtimePublisherCommitStep(
  commit: RuntimePublisherCommitResult,
  heartbeat: RuntimePublisherHeartbeatResult | undefined,
  observed: RuntimeObservedUploadPayload,
  slot: UploadSlot
): SuccessfulRuntimePublisherUploadStep | FailedRuntimePublisherCommitStep {
  if (isSuccessfulPublisherStepStatus(commit.status)) {
    return {
      commit,
      ...heartbeatResult(heartbeat),
      observed,
      slot,
      status: commit.status,
    };
  }

  return {
    commit,
    observed,
    ...heartbeatResult(heartbeat),
    slot,
    status: "commit_failed",
  };
}

export function failedRuntimePublisherIssueStep(
  error: unknown,
  heartbeat: RuntimePublisherHeartbeatResult | undefined
): FailedRuntimePublisherIssueStep {
  return {
    error: errorMessage(error, "publisher upload failed"),
    ...heartbeatResult(heartbeat),
    status: "issue_failed",
  };
}

export function unissuedRuntimePublisherIssueStep(
  issue: RuntimePublisherIssueResult,
  heartbeat: RuntimePublisherHeartbeatResult | undefined
): FailedRuntimePublisherIssueStep {
  return {
    ...heartbeatResult(heartbeat),
    issue,
    status: "issue_failed",
  };
}

export function failedRuntimePublisherUploadObjectStep(
  error: unknown,
  heartbeat: RuntimePublisherHeartbeatResult | undefined,
  slot: UploadSlot
): FailedRuntimePublisherUploadObjectStep {
  return {
    error: errorMessage(error, "publisher upload failed"),
    ...heartbeatResult(heartbeat),
    slot,
    status: "upload_failed",
  };
}

export function failedRuntimePublisherCommitStep(
  error: unknown,
  heartbeat: RuntimePublisherHeartbeatResult | undefined,
  observed: RuntimeObservedUploadPayload,
  slot: UploadSlot
): FailedRuntimePublisherCommitStep {
  return {
    error: errorMessage(error, "publisher upload failed"),
    ...heartbeatResult(heartbeat),
    observed,
    slot,
    status: "commit_failed",
  };
}

export function publisherCommitPayload(
  options: RunRuntimePublisherUploadStepOptions,
  slot: UploadSlot,
  object: RuntimeObservedUploadPayload
): RuntimeCommitPayload {
  return {
    commitId: options.commitId,
    committedAt: options.committedAt,
    object,
    slotId: slot.slotId,
    ...optionalField("lateToleranceMs", options.lateToleranceMs),
    ...optionalField("maxSegments", options.maxSegments),
    ...optionalField("profile", options.profile),
  };
}

export async function runPublisherHeartbeat(
  heartbeat: RunRuntimePublisherUploadStepOptions["heartbeat"]
): Promise<
  | {
      result?: RuntimePublisherHeartbeatResult;
      status: "ready";
    }
  | {
      step: FailedRuntimePublisherHeartbeatStep;
      status: "failed";
    }
> {
  if (heartbeat === undefined) {
    return { status: "ready" };
  }

  try {
    const result = await heartbeat();

    if (result.status === "refreshed") {
      return { result, status: "ready" };
    }

    return {
      step: failedRuntimePublisherHeartbeatResultStep(result),
      status: "failed",
    };
  } catch (error) {
    return {
      step: failedRuntimePublisherHeartbeatErrorStep(error),
      status: "failed",
    };
  }
}

function failedRuntimePublisherHeartbeatResultStep(
  heartbeat: RuntimePublisherHeartbeatResult
): FailedRuntimePublisherHeartbeatStep {
  return {
    heartbeat,
    status: "heartbeat_failed",
  };
}

function failedRuntimePublisherHeartbeatErrorStep(
  error: unknown
): FailedRuntimePublisherHeartbeatStep {
  return {
    error: errorMessage(error, "publisher upload failed"),
    status: "heartbeat_failed",
  };
}

function heartbeatResult(
  heartbeat: RuntimePublisherHeartbeatResult | undefined
): { heartbeat?: RuntimePublisherHeartbeatResult } {
  return heartbeat === undefined ? {} : { heartbeat };
}

/**
 * Decide how the publisher loop proceeds after a step: `continue` on
 * `committed` or `idempotent`, otherwise `retry` with the incremented
 * attempt while `attempt + 1 < maxAttempts`, else `stop` with
 * `attempts_exhausted`. Throws on unknown step statuses or invalid
 * attempt counts.
 */
export function resolveRuntimePublisherLoopDecision(
  options: ResolveRuntimePublisherLoopDecisionOptions
): RuntimePublisherLoopDecision {
  const attempt = nonNegativeSafeInteger(options.attempt, "attempt");
  const maxAttempts = positiveSafeInteger(options.maxAttempts, "maxAttempts");
  assertPublisherStepStatus(options.step.status);

  if (isSuccessfulPublisherStepStatus(options.step.status)) {
    return { action: "continue" };
  }

  const nextAttempt = attempt + 1;

  if (nextAttempt < maxAttempts) {
    return {
      action: "retry",
      nextAttempt,
    };
  }

  return {
    action: "stop",
    reason: "attempts_exhausted",
  };
}

function assertPublisherStepStatus(status: string): void {
  if (isAllowedString(status, PUBLISHER_STEP_STATUSES)) {
    return;
  }

  throw new Error("publisher step status is unsupported");
}

function isSuccessfulPublisherStepStatus(
  status: string
): status is SuccessfulRuntimePublisherUploadStep["status"] {
  return isAllowedString(status, SUCCESSFUL_PUBLISHER_STEP_STATUSES);
}

export function isFailedRuntimePublisherIssueStep(
  result: RuntimePublisherIssuePhaseResult
): result is FailedRuntimePublisherIssueStep {
  return result.status === "issue_failed";
}

export function isFailedRuntimePublisherUploadObjectStep(
  result: RuntimePublisherUploadObjectPhaseResult
): result is FailedRuntimePublisherUploadObjectStep {
  return result.status === "upload_failed";
}

export function isFailedRuntimePublisherCommitStep(
  result: RuntimePublisherCommitPhaseResult
): result is FailedRuntimePublisherCommitStep {
  return result.status === "commit_failed";
}

export function isIssuedRuntimePublisherIssueResult(
  result: RuntimePublisherIssueResult
): result is IssuedRuntimePublisherIssueResult {
  return result.status === "issued" && result.slot !== undefined;
}
