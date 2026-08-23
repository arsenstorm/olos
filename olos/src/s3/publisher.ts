import type { RuntimePublisherHeartbeatResult } from "../runtime/publisher";
import { createRuntimePublisherNextObjectPlan } from "../runtime/publisher-cadence";
import { resolveRuntimePublisherObjectExpiry } from "../runtime/publisher-expiry";
import { createRuntimePublisherObjectPlan } from "../runtime/publisher-plan";
import type { UploadSlot } from "../types/upload-slot";
import { errorMessage } from "../validation/fields";
import {
  commitStoredS3CoordinatorUpload,
  issueStoredS3CoordinatorUploadGrant,
} from "./coordinator-grant";
import type {
  StoredS3CoordinatorUploadCommit,
  StoredS3CoordinatorUploadGrantIssue,
} from "./coordinator-types";
import {
  committedStoredS3PublisherUploadStep,
  failedStoredS3PublisherCommitStep,
  failedStoredS3PublisherIssueStep,
  failedStoredS3PublisherUploadObjectStep,
  unissuedStoredS3PublisherIssueStep,
} from "./publisher-steps";
import type {
  FailedStoredS3PublisherIssueStep,
  NextStoredS3PublisherUploadStep,
  PlannedStoredS3PublisherUploadStep,
  ReadyStoredS3PublisherHeartbeat,
  RunNextStoredS3PublisherUploadStepOptions,
  RunPlannedStoredS3PublisherUploadStepOptions,
  RunStoredS3PublisherUploadStepOptions,
  SavedStoredS3CoordinatorUploadGrantIssue,
  StoredS3PublisherCommitUploadOptions,
  StoredS3PublisherGrantIssueOptions,
  StoredS3PublisherObjectPlanStepOptions,
  StoredS3PublisherUploadStep,
} from "./publisher-types";
/**
 * Run one publisher upload step for a caller-supplied object plan. Resolves
 * the grant expiry from the object cadence, target latency, and TTL floor,
 * finalizes the plan with it, then drives the heartbeat, grant issue,
 * upload, and commit phases against the stored session. Phase failures are
 * returned as step statuses, not thrown.
 */
export async function runPlannedStoredS3PublisherUploadStep(
  options: RunPlannedStoredS3PublisherUploadStepOptions
): Promise<PlannedStoredS3PublisherUploadStep> {
  const expiry = resolveRuntimePublisherObjectExpiry({
    cadenceSeconds: options.cadenceSeconds,
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

/**
 * Plan and publish the next object on the publisher's cadence: derives the
 * next object plan (sequence position, timing, expiry) from the cadence
 * options, then runs the same step pipeline as
 * {@link runPlannedStoredS3PublisherUploadStep}. The result adds the
 * cadence `position` the object was published at.
 */
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

/**
 * Drive one upload step through caller-supplied callbacks: heartbeat (when
 * given), grant issue, upload, then commit, stopping at the first failed
 * phase. Callback exceptions are captured as the matching `*_failed` status
 * rather than thrown, so the returned step always tells the caller how far
 * the pipeline got.
 */
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
    heartbeat: options.heartbeat,
    issueGrant: () =>
      issueStoredS3CoordinatorUploadGrant(
        storedS3PublisherGrantIssueOptions(options)
      ),
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
    commitPolicy: options.commitPolicy,
    committedAt: options.committedAt,
    lateToleranceMs: options.lateToleranceMs,
    manifest: options.manifest,
    maxAttempts: options.maxAttempts,
    maxSegments: options.maxSegments,
    profile: options.profile,
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

/** Either the lease is fresh enough to upload against, or the step stops. */
type PublisherHeartbeatOutcome =
  | { result?: RuntimePublisherHeartbeatResult; status: "ready" }
  | {
      status: "failed";
      step: Extract<
        StoredS3PublisherUploadStep,
        { status: "heartbeat_failed" }
      >;
    };

async function runPublisherHeartbeat(
  heartbeat: RunStoredS3PublisherUploadStepOptions["heartbeat"]
): Promise<PublisherHeartbeatOutcome> {
  if (heartbeat === undefined) {
    return { status: "ready" };
  }

  try {
    const result = await heartbeat();

    return result.status === "refreshed"
      ? { result, status: "ready" }
      : {
          status: "failed",
          step: { heartbeat: result, status: "heartbeat_failed" },
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
