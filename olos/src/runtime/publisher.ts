import type { UploadSlot } from "../types/upload-slot";
import { errorMessage, isAllowedString } from "../validation/fields";
import type {
  RuntimeCommitPayload,
  RuntimeObservedUploadPayload,
} from "./commit";
import {
  nonNegativeSafeInteger,
  optionalField,
  positiveSafeInteger,
} from "./request-fields";
import type { RuntimeSlotIssuePayload } from "./slot";

/**
 * Result of a publisher's slot-issue callback. Any status other than
 * `issued`, or a missing `slot`, counts as a failed issue phase.
 */
export interface RuntimePublisherIssueResult {
  slot?: UploadSlot;
  status: string;
}

/**
 * Result of a publisher's commit callback. Only `committed` and
 * `idempotent` count as success; anything else fails the commit phase.
 */
export interface RuntimePublisherCommitResult {
  status: string;
}

/**
 * Result of a publisher's heartbeat callback. Only `refreshed` counts as
 * success; anything else fails the step before a slot is issued.
 */
export interface RuntimePublisherHeartbeatResult {
  status: string;
}

/**
 * Options for `runRuntimePublisherUploadStep`: the transport callbacks for
 * each phase plus the commit fields the step should send.
 */
export interface RunRuntimePublisherUploadStepOptions {
  /** Commits the uploaded object (e.g. via `commitRuntimeUpload`). */
  commit(payload: RuntimeCommitPayload): Promise<RuntimePublisherCommitResult>;
  commitId: string;
  /** Commit timestamp sent in the payload, as an ISO 8601 string. */
  committedAt: string;
  /** Optional lease refresh, run first; a failure aborts the step. */
  heartbeat?(): Promise<RuntimePublisherHeartbeatResult>;
  /** Mark the committed segment as independent (a keyframe boundary). */
  independent?: boolean;
  /** Issues the upload slot (e.g. via `issueRuntimeSlot`). */
  issueSlot(
    payload: RuntimeSlotIssuePayload
  ): Promise<RuntimePublisherIssueResult>;
  /** Commit late tolerance forwarded in the payload, in milliseconds. */
  lateToleranceMs?: number;
  maxSegments?: number;
  programDateTime?: string;
  /** Slot issue payload describing the object about to be uploaded. */
  slot: RuntimeSlotIssuePayload;
  /** Uploads the object to the issued slot and reports what was stored. */
  upload(slot: UploadSlot): Promise<RuntimeObservedUploadPayload>;
}

/** Options for `resolveRuntimePublisherLoopDecision`. */
export interface ResolveRuntimePublisherLoopDecisionOptions {
  /** Zero-based attempt index of the step that just ran. */
  attempt: number;
  /** Total attempts allowed per object, including the first. */
  maxAttempts: number;
  step: RuntimePublisherStepStatus;
}

/** The part of an upload step the loop decision looks at: its status. */
export interface RuntimePublisherStepStatus {
  status: RuntimePublisherUploadStepStatus;
}

/** Status discriminant of `RuntimePublisherUploadStep`. */
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

/**
 * What the publisher loop should do next: `continue` to the next object,
 * `retry` the same object as `nextAttempt`, or `stop` because the attempt
 * budget is exhausted.
 */
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

/**
 * Outcome of one publisher upload step. `committed` / `idempotent` carry
 * everything the step produced (slot, observed upload, commit result);
 * the `*_failed` variants identify the phase that failed and preserve
 * whatever earlier phases yielded, with `error` set when the phase threw.
 */
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

type RuntimePublisherIssuePhaseResult =
  | FailedRuntimePublisherIssueStep
  | IssuedRuntimePublisherIssueResult;

type RuntimePublisherUploadObjectPhaseResult =
  | FailedRuntimePublisherUploadObjectStep
  | {
      observed: RuntimeObservedUploadPayload;
      status: "uploaded";
    };

type RuntimePublisherCommitPhaseResult =
  | FailedRuntimePublisherCommitStep
  | {
      commit: RuntimePublisherCommitResult;
      status: "resolved";
    };

const SUCCESSFUL_PUBLISHER_STEP_STATUSES = [
  "committed",
  "idempotent",
] as const satisfies readonly SuccessfulRuntimePublisherUploadStep["status"][];

/**
 * Run one publisher iteration — optional heartbeat, then slot issue,
 * upload, and commit — stopping at the first failed phase. Callback throws
 * are caught and folded into the corresponding `*_failed` step rather than
 * propagated, so the caller can feed every outcome straight into
 * `resolveRuntimePublisherLoopDecision`.
 */
export async function runRuntimePublisherUploadStep(
  options: RunRuntimePublisherUploadStepOptions
): Promise<RuntimePublisherUploadStep> {
  const heartbeat = await runPublisherHeartbeat(options.heartbeat);

  if (heartbeat.status === "failed") {
    return heartbeat.step;
  }

  const issued = await runPublisherIssueSlot(options, heartbeat.result);

  if (isFailedRuntimePublisherIssueStep(issued)) {
    return issued;
  }

  return await runPublisherUploadAndCommit(options, heartbeat.result, issued);
}

async function runPublisherUploadAndCommit(
  options: RunRuntimePublisherUploadStepOptions,
  heartbeat: RuntimePublisherHeartbeatResult | undefined,
  issued: IssuedRuntimePublisherIssueResult
): Promise<RuntimePublisherUploadStep> {
  const uploaded = await runPublisherUploadObject(options, heartbeat, issued);

  if (isFailedRuntimePublisherUploadObjectStep(uploaded)) {
    return uploaded;
  }

  const committed = await runPublisherCommitUpload(
    options,
    heartbeat,
    uploaded,
    issued
  );

  if (isFailedRuntimePublisherCommitStep(committed)) {
    return committed;
  }

  return runtimePublisherCommitStep(
    committed.commit,
    heartbeat,
    uploaded.observed,
    issued.slot
  );
}

async function runPublisherCommitUpload(
  options: RunRuntimePublisherUploadStepOptions,
  heartbeat: RuntimePublisherHeartbeatResult | undefined,
  uploaded: Extract<
    RuntimePublisherUploadObjectPhaseResult,
    { status: "uploaded" }
  >,
  issued: IssuedRuntimePublisherIssueResult
): Promise<RuntimePublisherCommitPhaseResult> {
  try {
    return {
      commit: await options.commit(
        publisherCommitPayload(options, issued.slot, uploaded.observed)
      ),
      status: "resolved",
    };
  } catch (error) {
    return failedRuntimePublisherCommitStep(
      error,
      heartbeat,
      uploaded.observed,
      issued.slot
    );
  }
}

async function runPublisherUploadObject(
  options: RunRuntimePublisherUploadStepOptions,
  heartbeat: RuntimePublisherHeartbeatResult | undefined,
  issued: IssuedRuntimePublisherIssueResult
): Promise<RuntimePublisherUploadObjectPhaseResult> {
  try {
    return {
      observed: await options.upload(issued.slot),
      status: "uploaded",
    };
  } catch (error) {
    return failedRuntimePublisherUploadObjectStep(
      error,
      heartbeat,
      issued.slot
    );
  }
}

async function runPublisherIssueSlot(
  options: RunRuntimePublisherUploadStepOptions,
  heartbeat: RuntimePublisherHeartbeatResult | undefined
): Promise<RuntimePublisherIssuePhaseResult> {
  try {
    const issued = await options.issueSlot(options.slot);

    if (isIssuedRuntimePublisherIssueResult(issued)) {
      return issued;
    }

    return unissuedRuntimePublisherIssueStep(issued, heartbeat);
  } catch (error) {
    return failedRuntimePublisherIssueStep(error, heartbeat);
  }
}

function runtimePublisherCommitStep(
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

function isFailedRuntimePublisherIssueStep(
  result: RuntimePublisherIssuePhaseResult
): result is FailedRuntimePublisherIssueStep {
  return result.status === "issue_failed";
}

function isFailedRuntimePublisherUploadObjectStep(
  result: RuntimePublisherUploadObjectPhaseResult
): result is FailedRuntimePublisherUploadObjectStep {
  return result.status === "upload_failed";
}

function isFailedRuntimePublisherCommitStep(
  result: RuntimePublisherCommitPhaseResult
): result is FailedRuntimePublisherCommitStep {
  return result.status === "commit_failed";
}

function isIssuedRuntimePublisherIssueResult(
  result: RuntimePublisherIssueResult
): result is IssuedRuntimePublisherIssueResult {
  return result.status === "issued" && result.slot !== undefined;
}
