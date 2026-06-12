import type { S3Client } from "@aws-sdk/client-s3";
import type { CoordinatorPipelineStore } from "../protocol";
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
import type { PublicationControlPolicy } from "../state/publication-control";
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
  issueGrant(): Promise<StoredS3CoordinatorUploadGrantIssue>;
  upload(grant: UploadGrant): Promise<void>;
}

export interface RunPlannedStoredS3PublisherUploadStepOptions {
  additionalHeaders?: Record<string, string>;
  bucket: string;
  client: S3Client;
  committedAt: string;
  headObjectClient?: S3HeadObjectClient;
  independent?: boolean;
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
      slot: UploadSlot;
      status: "committed" | "idempotent";
    }
  | {
      error?: string;
      issue?: Exclude<StoredS3CoordinatorUploadGrantIssue, { status: "saved" }>;
      status: "issue_failed";
    }
  | {
      error: string;
      grant: UploadGrant;
      slot: UploadSlot;
      status: "upload_failed";
    }
  | {
      commit?: StoredS3CoordinatorUploadCommit;
      error?: string;
      grant: UploadGrant;
      slot: UploadSlot;
      status: "commit_failed";
    };

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
  let issued: StoredS3CoordinatorUploadGrantIssue;

  try {
    issued = await options.issueGrant();
  } catch (error) {
    return {
      error: errorMessage(error),
      status: "issue_failed",
    };
  }

  if (issued.status !== "saved") {
    return {
      issue: issued,
      status: "issue_failed",
    };
  }

  try {
    await options.upload(issued.grant);
  } catch (error) {
    return {
      error: errorMessage(error),
      grant: issued.grant,
      slot: issued.slot,
      status: "upload_failed",
    };
  }

  let committed: StoredS3CoordinatorUploadCommit;

  try {
    committed = await options.commit(issued.slot);
  } catch (error) {
    return {
      error: errorMessage(error),
      grant: issued.grant,
      slot: issued.slot,
      status: "commit_failed",
    };
  }

  if (committed.status === "committed" || committed.status === "idempotent") {
    return {
      commit: committed,
      grant: issued.grant,
      slot: issued.slot,
      status: committed.status,
    };
  }

  return {
    commit: committed,
    grant: issued.grant,
    slot: issued.slot,
    status: "commit_failed",
  };
}

export function summarizeStoredS3PublisherUploadStep(
  step: StoredS3PublisherUploadStep
): StoredS3PublisherUploadStepSummary {
  const slot = "slot" in step ? step.slot : undefined;
  const commit = "commit" in step ? step.commit : undefined;
  const issue = "issue" in step ? step.issue : undefined;
  const error = "error" in step ? step.error : undefined;

  return {
    ...(commit !== undefined && "commit" in commit
      ? { commitId: commit.commit.commitId }
      : {}),
    ...(commit === undefined ? {} : { commitStatus: commit.status }),
    ...(error === undefined ? {} : { error }),
    ...(issue === undefined ? {} : { issueStatus: issue.status }),
    ...(slot === undefined
      ? {}
      : {
          objectKey: slot.objectKey,
          slotId: slot.slotId,
        }),
    ok: step.status === "committed" || step.status === "idempotent",
    status: step.status,
  };
}

async function runStoredS3PublisherObjectPlanStep(
  options: Omit<RunPlannedStoredS3PublisherUploadStepOptions, "plan"> & {
    expiry: RuntimePublisherObjectExpiry;
    plan: RuntimePublisherObjectPlan;
  }
): Promise<PlannedStoredS3PublisherUploadStep> {
  const step = await runStoredS3PublisherUploadStep({
    commit: (slot) =>
      commitStoredS3CoordinatorUpload({
        bucket: options.bucket,
        client: options.headObjectClient ?? options.client,
        commitId: options.plan.commitId,
        committedAt: options.committedAt,
        independent: options.independent,
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
      }),
    issueGrant: () =>
      issueStoredS3CoordinatorUploadGrant({
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
      }),
    upload: (grant) => options.upload(grant, options.plan),
  });

  return {
    ...step,
    expiry: options.expiry,
    plan: options.plan,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "S3 publisher step failed";
}
