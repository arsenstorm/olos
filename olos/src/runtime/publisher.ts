import type { UploadSlot } from "../types/upload-slot";
import type {
  RuntimeCommitPayload,
  RuntimeObservedUploadPayload,
} from "./commit";
import { errorMessage } from "./errors";
import { optionalField } from "./optional-field";
import type { RuntimeSlotIssuePayload } from "./slot";
import { isStringLiteral } from "./string-literals";

export interface RuntimePublisherIssueResult {
  slot?: UploadSlot;
  status: string;
}

export interface RuntimePublisherCommitResult {
  status: string;
}

export interface RuntimePublisherHeartbeatResult {
  status: string;
}

export interface RunRuntimePublisherUploadStepOptions {
  commit(payload: RuntimeCommitPayload): Promise<RuntimePublisherCommitResult>;
  commitId: string;
  committedAt: string;
  heartbeat?(): Promise<RuntimePublisherHeartbeatResult>;
  independent?: boolean;
  issueSlot(
    payload: RuntimeSlotIssuePayload
  ): Promise<RuntimePublisherIssueResult>;
  lateToleranceMs?: number;
  maxSegments?: number;
  programDateTime?: string;
  slot: RuntimeSlotIssuePayload;
  upload(slot: UploadSlot): Promise<RuntimeObservedUploadPayload>;
}

export interface ResolveRuntimePublisherLoopDecisionOptions {
  attempt: number;
  maxAttempts: number;
  step: RuntimePublisherStepStatus;
}

export interface RuntimePublisherStepStatus {
  status: RuntimePublisherUploadStepStatus;
}

export type RuntimePublisherUploadStepStatus =
  RuntimePublisherUploadStep["status"];

const PUBLISHER_STEP_STATUSES = [
  "committed",
  "idempotent",
  "heartbeat_failed",
  "issue_failed",
  "upload_failed",
  "commit_failed",
] as const satisfies readonly RuntimePublisherUploadStepStatus[];

export type RuntimePublisherLoopDecision =
  | {
      action: "continue";
    }
  | {
      action: "retry";
      nextAttempt: number;
    }
  | {
      action: "stop";
      reason: "attempts_exhausted";
    };

export type RuntimePublisherUploadStep =
  | {
      commit: RuntimePublisherCommitResult;
      heartbeat?: RuntimePublisherHeartbeatResult;
      observed: RuntimeObservedUploadPayload;
      slot: UploadSlot;
      status: "committed" | "idempotent";
    }
  | {
      error?: string;
      heartbeat?: RuntimePublisherHeartbeatResult;
      status: "heartbeat_failed";
    }
  | {
      error?: string;
      heartbeat?: RuntimePublisherHeartbeatResult;
      issue?: RuntimePublisherIssueResult;
      status: "issue_failed";
    }
  | {
      error: string;
      heartbeat?: RuntimePublisherHeartbeatResult;
      slot: UploadSlot;
      status: "upload_failed";
    }
  | {
      commit?: RuntimePublisherCommitResult;
      error?: string;
      heartbeat?: RuntimePublisherHeartbeatResult;
      observed: RuntimeObservedUploadPayload;
      slot: UploadSlot;
      status: "commit_failed";
    };

type SuccessfulRuntimePublisherUploadStep = Extract<
  RuntimePublisherUploadStep,
  { status: "committed" | "idempotent" }
>;

type FailedRuntimePublisherHeartbeatStep = Extract<
  RuntimePublisherUploadStep,
  { status: "heartbeat_failed" }
>;

type FailedRuntimePublisherIssueStep = Extract<
  RuntimePublisherUploadStep,
  { status: "issue_failed" }
>;

type FailedRuntimePublisherUploadObjectStep = Extract<
  RuntimePublisherUploadStep,
  { status: "upload_failed" }
>;

type FailedRuntimePublisherCommitStep = Extract<
  RuntimePublisherUploadStep,
  { status: "commit_failed" }
>;

type IssuedRuntimePublisherIssueResult = RuntimePublisherIssueResult & {
  slot: UploadSlot;
  status: "issued";
};

const SUCCESSFUL_PUBLISHER_STEP_STATUSES = [
  "committed",
  "idempotent",
] as const satisfies readonly SuccessfulRuntimePublisherUploadStep["status"][];

export async function runRuntimePublisherUploadStep(
  options: RunRuntimePublisherUploadStepOptions
): Promise<RuntimePublisherUploadStep> {
  const heartbeat = await runPublisherHeartbeat(options.heartbeat);

  if (heartbeat.status === "failed") {
    return heartbeat.step;
  }

  let issued: RuntimePublisherIssueResult;

  try {
    issued = await options.issueSlot(options.slot);
  } catch (error) {
    return failedRuntimePublisherIssueStep(error, heartbeat.result);
  }

  if (!isIssuedRuntimePublisherIssueResult(issued)) {
    return unissuedRuntimePublisherIssueStep(issued, heartbeat.result);
  }

  let observed: RuntimeObservedUploadPayload;

  try {
    observed = await options.upload(issued.slot);
  } catch (error) {
    return failedRuntimePublisherUploadObjectStep(
      error,
      heartbeat.result,
      issued.slot
    );
  }

  let committed: RuntimePublisherCommitResult;

  try {
    committed = await options.commit(
      publisherCommitPayload(options, issued.slot, observed)
    );
  } catch (error) {
    return failedRuntimePublisherCommitStep(
      error,
      heartbeat.result,
      observed,
      issued.slot
    );
  }

  if (isSuccessfulPublisherStepStatus(committed.status)) {
    return {
      commit: committed,
      ...heartbeatResult(heartbeat.result),
      observed,
      slot: issued.slot,
      status: committed.status,
    };
  }

  return {
    commit: committed,
    observed,
    ...heartbeatResult(heartbeat.result),
    slot: issued.slot,
    status: "commit_failed",
  };
}

function failedRuntimePublisherIssueStep(
  error: unknown,
  heartbeat: RuntimePublisherHeartbeatResult | undefined
): FailedRuntimePublisherIssueStep {
  return {
    error: errorMessage(error, "publisher upload failed"),
    ...heartbeatResult(heartbeat),
    status: "issue_failed",
  };
}

function unissuedRuntimePublisherIssueStep(
  issue: RuntimePublisherIssueResult,
  heartbeat: RuntimePublisherHeartbeatResult | undefined
): FailedRuntimePublisherIssueStep {
  return {
    ...heartbeatResult(heartbeat),
    issue,
    status: "issue_failed",
  };
}

function failedRuntimePublisherUploadObjectStep(
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

function failedRuntimePublisherCommitStep(
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

function publisherCommitPayload(
  options: RunRuntimePublisherUploadStepOptions,
  slot: UploadSlot,
  object: RuntimeObservedUploadPayload
): RuntimeCommitPayload {
  return {
    commitId: options.commitId,
    committedAt: options.committedAt,
    object,
    slotId: slot.slotId,
    ...optionalField("independent", options.independent),
    ...optionalField("lateToleranceMs", options.lateToleranceMs),
    ...optionalField("maxSegments", options.maxSegments),
    ...optionalField("programDateTime", options.programDateTime),
  };
}

async function runPublisherHeartbeat(
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
      status: "failed",
      step: {
        heartbeat: result,
        status: "heartbeat_failed",
      },
    };
  } catch (error) {
    return {
      status: "failed",
      step: {
        error: errorMessage(error, "publisher upload failed"),
        status: "heartbeat_failed",
      },
    };
  }
}

function heartbeatResult(
  heartbeat: RuntimePublisherHeartbeatResult | undefined
): { heartbeat?: RuntimePublisherHeartbeatResult } {
  return heartbeat === undefined ? {} : { heartbeat };
}

export function resolveRuntimePublisherLoopDecision(
  options: ResolveRuntimePublisherLoopDecisionOptions
): RuntimePublisherLoopDecision {
  const attempt = nonNegativeInteger(options.attempt, "attempt");
  const maxAttempts = positiveInteger(options.maxAttempts, "maxAttempts");
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
  if (isStringLiteral(status, PUBLISHER_STEP_STATUSES)) {
    return;
  }

  throw new Error("publisher step status is unsupported");
}

function isSuccessfulPublisherStepStatus(
  status: string
): status is SuccessfulRuntimePublisherUploadStep["status"] {
  return isStringLiteral(status, SUCCESSFUL_PUBLISHER_STEP_STATUSES);
}

function isIssuedRuntimePublisherIssueResult(
  result: RuntimePublisherIssueResult
): result is IssuedRuntimePublisherIssueResult {
  return result.status === "issued" && result.slot !== undefined;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}
