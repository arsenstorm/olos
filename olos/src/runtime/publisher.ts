import type { ProfileData } from "../types/profile";
import type { UploadSlot } from "../types/upload-slot";
import type {
  RuntimeCommitPayload,
  RuntimeObservedUploadPayload,
} from "./commit";
import {
  failedRuntimePublisherCommitStep,
  failedRuntimePublisherIssueStep,
  failedRuntimePublisherUploadObjectStep,
  isFailedRuntimePublisherCommitStep,
  isFailedRuntimePublisherIssueStep,
  isFailedRuntimePublisherUploadObjectStep,
  isIssuedRuntimePublisherIssueResult,
  publisherCommitPayload,
  runPublisherHeartbeat,
  runtimePublisherCommitStep,
  unissuedRuntimePublisherIssueStep,
} from "./publisher-steps";
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
  /** Issues the upload slot (e.g. via `issueRuntimeSlot`). */
  issueSlot(
    payload: RuntimeSlotIssuePayload
  ): Promise<RuntimePublisherIssueResult>;
  /** Commit late tolerance forwarded in the payload, in milliseconds. */
  lateToleranceMs?: number;
  maxSegments?: number;
  /** Profile data sent with the commit (opaque to Core). */
  profile?: ProfileData;
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

export const PUBLISHER_STEP_STATUSES = [
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

export type SuccessfulRuntimePublisherUploadStep = Extract<
  RuntimePublisherUploadStep,
  { status: "committed" | "idempotent" }
>;

export type FailedRuntimePublisherHeartbeatStep = Extract<
  RuntimePublisherUploadStep,
  { status: "heartbeat_failed" }
>;

export type FailedRuntimePublisherIssueStep = Extract<
  RuntimePublisherUploadStep,
  { status: "issue_failed" }
>;

export type FailedRuntimePublisherUploadObjectStep = Extract<
  RuntimePublisherUploadStep,
  { status: "upload_failed" }
>;

export type FailedRuntimePublisherCommitStep = Extract<
  RuntimePublisherUploadStep,
  { status: "commit_failed" }
>;

export type IssuedRuntimePublisherIssueResult = RuntimePublisherIssueResult & {
  slot: UploadSlot;
  status: "issued";
};

export type RuntimePublisherIssuePhaseResult =
  | FailedRuntimePublisherIssueStep
  | IssuedRuntimePublisherIssueResult;

export type RuntimePublisherUploadObjectPhaseResult =
  | FailedRuntimePublisherUploadObjectStep
  | {
      observed: RuntimeObservedUploadPayload;
      status: "uploaded";
    };

export type RuntimePublisherCommitPhaseResult =
  | FailedRuntimePublisherCommitStep
  | {
      commit: RuntimePublisherCommitResult;
      status: "resolved";
    };

export const SUCCESSFUL_PUBLISHER_STEP_STATUSES = [
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
