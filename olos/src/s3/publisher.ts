import type { S3Client } from "@aws-sdk/client-s3";
import type {
  CoordinatorCommitPolicy,
  CoordinatorPipelineStore,
} from "../protocol";
import { errorMessage } from "../runtime/errors";
import type { RuntimePublisherHeartbeatResult } from "../runtime/publisher";
import {
  type CreateRuntimePublisherNextObjectPlanOptions,
  createRuntimePublisherNextObjectPlan,
  type RuntimePublisherObjectPosition,
} from "../runtime/publisher-cadence";
import {
  type RuntimePublisherObjectExpiry,
  resolveRuntimePublisherObjectExpiry,
} from "../runtime/publisher-expiry";
import {
  type CreateRuntimePublisherObjectPlanOptions,
  createRuntimePublisherObjectPlan,
  type RuntimePublisherObjectPlan,
} from "../runtime/publisher-plan";
import { isStringLiteral } from "../runtime/string-literals";
import type { PublicationControlPolicy } from "../state/publication-control";
import type { OlosErrorCode } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { UploadGrant } from "../types/upload-grant";
import type { UploadSlot } from "../types/upload-slot";
import type {
  StoredS3CoordinatorManifestOptions,
  StoredS3CoordinatorUploadCommit,
  StoredS3CoordinatorUploadGrantIssue,
} from "./coordinator";
import {
  commitStoredS3CoordinatorUpload,
  issueStoredS3CoordinatorUploadGrant,
} from "./coordinator";
import type { S3HeadObjectClient } from "./object-observation";

export interface RunStoredS3PublisherUploadStepOptions {
  commit(slot: UploadSlot): Promise<StoredS3CoordinatorUploadCommit>;
  heartbeat?(): Promise<RuntimePublisherHeartbeatResult>;
  issueGrant(): Promise<StoredS3CoordinatorUploadGrantIssue>;
  upload(grant: UploadGrant): Promise<void>;
}

export interface RunPlannedStoredS3PublisherUploadStepOptions {
  additionalHeaders?: Record<string, string>;
  bucket: string;
  client: S3Client;
  commitPolicy?: CoordinatorCommitPolicy;
  committedAt: string;
  headObjectClient?: S3HeadObjectClient;
  heartbeat?(): Promise<RuntimePublisherHeartbeatResult>;
  independent?: boolean;
  lateToleranceMs?: number;
  manifest?: StoredS3CoordinatorManifestOptions;
  maxAttempts?: number;
  maxSegments?: number;
  minTtlSeconds?: number;
  now: Date | string;
  plan: Omit<CreateRuntimePublisherObjectPlanOptions, "expiresAt">;
  programDateTime?: string;
  providerId: string;
  publicationControl?: PublicationControlPolicy;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
  targetLatency: number;
  upload(grant: UploadGrant, plan: RuntimePublisherObjectPlan): Promise<void>;
  versionId?: string;
}

export interface RunNextStoredS3PublisherUploadStepOptions
  extends Omit<
      RunPlannedStoredS3PublisherUploadStepOptions,
      "minTtlSeconds" | "plan" | "targetLatency"
    >,
    CreateRuntimePublisherNextObjectPlanOptions {}

export type StoredS3PublisherUploadStep =
  | {
      commit: StoredS3CoordinatorUploadCommit;
      grant: UploadGrant;
      heartbeat?: RuntimePublisherHeartbeatResult;
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
      issue?: Exclude<StoredS3CoordinatorUploadGrantIssue, { status: "saved" }>;
      status: "issue_failed";
    }
  | {
      error: string;
      grant: UploadGrant;
      heartbeat?: RuntimePublisherHeartbeatResult;
      slot: UploadSlot;
      status: "upload_failed";
    }
  | {
      commit?: StoredS3CoordinatorUploadCommit;
      error?: string;
      grant: UploadGrant;
      heartbeat?: RuntimePublisherHeartbeatResult;
      slot: UploadSlot;
      status: "commit_failed";
    };

type SuccessfulStoredS3PublisherUploadStep = Extract<
  StoredS3PublisherUploadStep,
  { status: "committed" | "idempotent" }
>;

type FailedStoredS3PublisherIssueStep = Extract<
  StoredS3PublisherUploadStep,
  { status: "issue_failed" }
>;

type FailedStoredS3PublisherUploadObjectStep = Extract<
  StoredS3PublisherUploadStep,
  { status: "upload_failed" }
>;

type FailedStoredS3PublisherCommitStep = Extract<
  StoredS3PublisherUploadStep,
  { status: "commit_failed" }
>;

type StoredS3PublisherErrorCodeResult =
  | StoredS3CoordinatorUploadCommit
  | Exclude<StoredS3CoordinatorUploadGrantIssue, { status: "saved" }>;

type RejectedStoredS3PublisherErrorCodeResult = Extract<
  StoredS3PublisherErrorCodeResult,
  { status: "rejected" }
>;

type SavedStoredS3CoordinatorUploadGrantIssue = Extract<
  StoredS3CoordinatorUploadGrantIssue,
  { status: "saved" }
>;

type StoredS3PublisherObjectPlanStepOptions = Omit<
  RunPlannedStoredS3PublisherUploadStepOptions,
  "plan"
> & {
  expiry: RuntimePublisherObjectExpiry;
  plan: RuntimePublisherObjectPlan;
};

type StoredS3PublisherCommitUploadOptions = Parameters<
  typeof commitStoredS3CoordinatorUpload
>[0];

type StoredS3PublisherGrantIssueOptions = Parameters<
  typeof issueStoredS3CoordinatorUploadGrant
>[0];

type ReadyStoredS3PublisherHeartbeat =
  | RuntimePublisherHeartbeatResult
  | undefined;

const SUCCESSFUL_STORED_S3_PUBLISHER_STEP_STATUSES = [
  "committed",
  "idempotent",
] as const satisfies readonly SuccessfulStoredS3PublisherUploadStep["status"][];

export type PlannedStoredS3PublisherUploadStep = StoredS3PublisherUploadStep & {
  expiry: RuntimePublisherObjectExpiry;
  plan: RuntimePublisherObjectPlan;
};

export type NextStoredS3PublisherUploadStep =
  PlannedStoredS3PublisherUploadStep & {
    position: RuntimePublisherObjectPosition;
  };

export interface StoredS3PublisherUploadStepSummary {
  commitId?: OlosId;
  commitStatus?: StoredS3CoordinatorUploadCommit["status"];
  error?: string;
  errorCode?: OlosErrorCode;
  heartbeatStatus?: RuntimePublisherHeartbeatResult["status"];
  issueStatus?: Exclude<
    StoredS3CoordinatorUploadGrantIssue,
    { status: "saved" }
  >["status"];
  objectKey?: string;
  ok: boolean;
  slotId?: OlosId;
  status: StoredS3PublisherUploadStep["status"];
}

export async function runPlannedStoredS3PublisherUploadStep(
  options: RunPlannedStoredS3PublisherUploadStepOptions
): Promise<PlannedStoredS3PublisherUploadStep> {
  const expiry = resolveRuntimePublisherObjectExpiry({
    duration: options.plan.duration,
    minTtlSeconds: options.minTtlSeconds,
    now: options.now,
    targetLatency: options.targetLatency,
  });
  const plan = createRuntimePublisherObjectPlan({
    ...options.plan,
    expiresAt: expiry.expiresAt,
  });

  return await runStoredS3PublisherObjectPlanStep({
    ...options,
    expiry,
    plan,
  });
}

export async function runNextStoredS3PublisherUploadStep(
  options: RunNextStoredS3PublisherUploadStepOptions
): Promise<NextStoredS3PublisherUploadStep> {
  const next = createRuntimePublisherNextObjectPlan(options);
  const step = await runStoredS3PublisherObjectPlanStep({
    ...options,
    expiry: next.expiry,
    plan: next.plan,
  });

  return {
    ...step,
    position: next.position,
  };
}

export async function runStoredS3PublisherUploadStep(
  options: RunStoredS3PublisherUploadStepOptions
): Promise<StoredS3PublisherUploadStep> {
  const heartbeat = await runPublisherHeartbeat(options.heartbeat);

  if (heartbeat.status === "failed") {
    return heartbeat.step;
  }

  const issued = await issueStoredS3PublisherUploadGrant(
    options,
    heartbeat.result
  );

  if (issued.status === "failed") {
    return issued.step;
  }

  return await uploadAndCommitStoredS3PublisherUploadGrant(
    options,
    heartbeat.result,
    issued.issue
  );
}

async function issueStoredS3PublisherUploadGrant(
  options: RunStoredS3PublisherUploadStepOptions,
  heartbeat: ReadyStoredS3PublisherHeartbeat
): Promise<
  | {
      issue: SavedStoredS3CoordinatorUploadGrantIssue;
      status: "issued";
    }
  | {
      status: "failed";
      step: FailedStoredS3PublisherIssueStep;
    }
> {
  let issued: StoredS3CoordinatorUploadGrantIssue;

  try {
    issued = await options.issueGrant();
  } catch (error) {
    return {
      status: "failed",
      step: failedStoredS3PublisherIssueStep(error, heartbeat),
    };
  }

  if (!isSavedStoredS3CoordinatorUploadGrantIssue(issued)) {
    return {
      status: "failed",
      step: unissuedStoredS3PublisherIssueStep(issued, heartbeat),
    };
  }

  return { issue: issued, status: "issued" };
}

async function uploadAndCommitStoredS3PublisherUploadGrant(
  options: RunStoredS3PublisherUploadStepOptions,
  heartbeat: ReadyStoredS3PublisherHeartbeat,
  issued: SavedStoredS3CoordinatorUploadGrantIssue
): Promise<StoredS3PublisherUploadStep> {
  try {
    await options.upload(issued.grant);
  } catch (error) {
    return failedStoredS3PublisherUploadObjectStep(
      error,
      heartbeat,
      issued.grant,
      issued.slot
    );
  }

  let committed: StoredS3CoordinatorUploadCommit;

  try {
    committed = await options.commit(issued.slot);
  } catch (error) {
    return failedStoredS3PublisherCommitStep(
      error,
      heartbeat,
      issued.grant,
      issued.slot
    );
  }

  return committedStoredS3PublisherUploadStep(committed, heartbeat, issued);
}

function committedStoredS3PublisherUploadStep(
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

function failedStoredS3PublisherIssueStep(
  error: unknown,
  heartbeat: RuntimePublisherHeartbeatResult | undefined
): FailedStoredS3PublisherIssueStep {
  return {
    error: errorMessage(error, "S3 publisher step failed"),
    ...heartbeatResult(heartbeat),
    status: "issue_failed",
  };
}

function unissuedStoredS3PublisherIssueStep(
  issue: Exclude<StoredS3CoordinatorUploadGrantIssue, { status: "saved" }>,
  heartbeat: RuntimePublisherHeartbeatResult | undefined
): FailedStoredS3PublisherIssueStep {
  return {
    ...heartbeatResult(heartbeat),
    issue,
    status: "issue_failed",
  };
}

function failedStoredS3PublisherUploadObjectStep(
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

function failedStoredS3PublisherCommitStep(
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

function isSuccessfulStoredS3PublisherStepStatus(
  status: string
): status is SuccessfulStoredS3PublisherUploadStep["status"] {
  return isStringLiteral(status, SUCCESSFUL_STORED_S3_PUBLISHER_STEP_STATUSES);
}

function resultErrorCode(
  result?: StoredS3PublisherErrorCodeResult
): OlosErrorCode | undefined {
  return isRejectedStoredS3PublisherErrorCodeResult(result)
    ? result.error.error.code
    : undefined;
}

function isRejectedStoredS3PublisherErrorCodeResult(
  result: StoredS3PublisherErrorCodeResult | undefined
): result is RejectedStoredS3PublisherErrorCodeResult {
  return result?.status === "rejected";
}

function isSavedStoredS3CoordinatorUploadGrantIssue(
  result: StoredS3CoordinatorUploadGrantIssue
): result is SavedStoredS3CoordinatorUploadGrantIssue {
  return result.status === "saved";
}

async function runStoredS3PublisherObjectPlanStep(
  options: StoredS3PublisherObjectPlanStepOptions
): Promise<PlannedStoredS3PublisherUploadStep> {
  const step = await runStoredS3PublisherUploadStep({
    commit: (slot) =>
      commitStoredS3CoordinatorUpload(
        storedS3PublisherCommitUploadOptions(options, slot)
      ),
    issueGrant: () =>
      issueStoredS3CoordinatorUploadGrant(
        storedS3PublisherGrantIssueOptions(options)
      ),
    heartbeat: options.heartbeat,
    upload: (grant) => options.upload(grant, options.plan),
  });

  return {
    ...step,
    expiry: options.expiry,
    plan: options.plan,
  };
}

function storedS3PublisherCommitUploadOptions(
  options: StoredS3PublisherObjectPlanStepOptions,
  slot: UploadSlot
): StoredS3PublisherCommitUploadOptions {
  return {
    bucket: options.bucket,
    client: options.headObjectClient ?? options.client,
    commitId: options.plan.commitId,
    committedAt: options.committedAt,
    commitPolicy: options.commitPolicy,
    independent: options.independent,
    lateToleranceMs: options.lateToleranceMs,
    manifest: options.manifest,
    maxAttempts: options.maxAttempts,
    maxSegments: options.maxSegments,
    programDateTime: options.programDateTime,
    providerId: options.providerId,
    publicationControl: options.publicationControl,
    sessionId: options.sessionId,
    slotId: slot.slotId,
    store: options.store,
    versionId: options.versionId,
  };
}

function storedS3PublisherGrantIssueOptions(
  options: StoredS3PublisherObjectPlanStepOptions
): StoredS3PublisherGrantIssueOptions {
  return {
    additionalHeaders: options.additionalHeaders,
    bucket: options.bucket,
    client: options.client,
    expiresInSeconds: options.expiry.ttlSeconds,
    maxAttempts: options.maxAttempts,
    now: options.now,
    publicationControl: options.publicationControl,
    sessionId: options.sessionId,
    store: options.store,
    ...options.plan.slot,
  };
}

async function runPublisherHeartbeat(
  heartbeat: RunStoredS3PublisherUploadStepOptions["heartbeat"]
): Promise<
  | {
      result?: RuntimePublisherHeartbeatResult;
      status: "ready";
    }
  | {
      status: "failed";
      step: Extract<
        StoredS3PublisherUploadStep,
        { status: "heartbeat_failed" }
      >;
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
        error: errorMessage(error, "S3 publisher step failed"),
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
