import type { UploadSlot } from "../types/upload-slot";
import type {
  RuntimeCommitPayload,
  RuntimeObservedUploadPayload,
} from "./commit";
import type { RuntimeSlotIssuePayload } from "./slot";

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
    return {
      error: errorMessage(error),
      ...heartbeatResult(heartbeat.result),
      status: "issue_failed",
    };
  }

  if (issued.status !== "issued" || issued.slot === undefined) {
    return {
      ...heartbeatResult(heartbeat.result),
      issue: issued,
      status: "issue_failed",
    };
  }

  let observed: RuntimeObservedUploadPayload;

  try {
    observed = await options.upload(issued.slot);
  } catch (error) {
    return {
      error: errorMessage(error),
      ...heartbeatResult(heartbeat.result),
      slot: issued.slot,
      status: "upload_failed",
    };
  }

  let committed: RuntimePublisherCommitResult;

  try {
    committed = await options.commit({
      commitId: options.commitId,
      committedAt: options.committedAt,
      object: observed,
      slotId: issued.slot.slotId,
      ...optionalBoolean("independent", options.independent),
      ...optionalNumber("maxSegments", options.maxSegments),
      ...optionalString("programDateTime", options.programDateTime),
    });
  } catch (error) {
    return {
      error: errorMessage(error),
      ...heartbeatResult(heartbeat.result),
      observed,
      slot: issued.slot,
      status: "commit_failed",
    };
  }

  if (committed.status === "committed" || committed.status === "idempotent") {
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

async function runPublisherHeartbeat(
  heartbeat: RunRuntimePublisherUploadStepOptions["heartbeat"]
): Promise<
  | {
      result?: RuntimePublisherHeartbeatResult;
      status: "ready";
    }
  | {
      status: "failed";
      step: Extract<RuntimePublisherUploadStep, { status: "heartbeat_failed" }>;
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
        error: errorMessage(error),
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

  if (
    options.step.status === "committed" ||
    options.step.status === "idempotent"
  ) {
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
  if (
    status === "committed" ||
    status === "idempotent" ||
    status === "heartbeat_failed" ||
    status === "issue_failed" ||
    status === "upload_failed" ||
    status === "commit_failed"
  ) {
    return;
  }

  throw new Error("publisher step status is unsupported");
}

function optionalBoolean<Key extends string>(
  key: Key,
  value: boolean | undefined
): Partial<Record<Key, boolean>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, boolean>);
}

function optionalNumber<Key extends string>(
  key: Key,
  value: number | undefined
): Partial<Record<Key, number>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, number>);
}

function optionalString<Key extends string>(
  key: Key,
  value: string | undefined
): Partial<Record<Key, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, string>);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "publisher upload failed";
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
