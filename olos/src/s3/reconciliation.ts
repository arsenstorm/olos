import type {
  CoordinatorCommitPolicy,
  CoordinatorPipelineStore,
} from "../protocol/coordinator-types";
import type { PublicationControlPolicy } from "../state/publication-control";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { OlosErrorCode } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { UploadSlot } from "../types/upload-slot";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertS3BucketName } from "./bucket";
import type {
  StoredS3CoordinatorManifestOptions,
  StoredS3CoordinatorUploadCommit,
} from "./coordinator-types";
import type { S3HeadObjectClient } from "./object-observation";
import {
  completedStoredS3CoordinatorUploadReconciliationSummary,
  initialStoredS3CoordinatorUploadReconciliationSummary,
  isMissingStoredS3CoordinatorReconciliationPlan,
  isMissingStoredS3CoordinatorUploadReconciliation,
  loadStoredS3CoordinatorReconciliationPlan,
  missingStoredS3CoordinatorUploadReconciliation,
  missingStoredS3CoordinatorUploadReconciliationSummary,
  planStoredS3CoordinatorReconciliation,
  reconcileStoredS3CoordinatorUploadSlots,
  summarizeStoredS3CoordinatorUploadReconciliationEntry,
} from "./reconciliation-summary";

export type SlotValue<T> = T | ((slot: UploadSlot) => T);
export type ReconciliationUploadSlot = UploadSlot & {
  state: "issued" | "upload_observed";
};
export const SUCCESSFUL_S3_RECONCILIATION_STATUSES = [
  "committed",
  "idempotent",
] as const;

export type SuccessfulS3ReconciliationStatus =
  (typeof SUCCESSFUL_S3_RECONCILIATION_STATUSES)[number];

export type RejectedS3CoordinatorUploadCommit = Extract<
  StoredS3CoordinatorUploadCommit,
  { status: "rejected" }
>;

/**
 * Options for {@link reconcileStoredS3CoordinatorUploads}. Per-commit
 * fields may be a fixed value or a function of the slot being reconciled.
 */
export interface ReconcileStoredS3CoordinatorUploadsOptions {
  bucket: string;
  client: S3HeadObjectClient;
  /** Commit id per slot (default: `reconcile_{slotId}`). */
  commitId?: SlotValue<OlosId>;
  commitPolicy?: CoordinatorCommitPolicy;
  /** Commit timestamp, fixed or derived per slot. */
  committedAt: SlotValue<string>;
  independent?: SlotValue<boolean | undefined>;
  lateToleranceMs?: SlotValue<number | undefined>;
  manifest?: StoredS3CoordinatorManifestOptions;
  maxAttempts?: number;
  maxSegments?: number;
  programDateTime?: SlotValue<string | undefined>;
  providerId: OlosId;
  publicationControl?: PublicationControlPolicy;
  sessionId: OlosId;
  /** Restricts the sweep to these slots; omitted, every eligible slot. */
  slotIds?: readonly OlosId[];
  store: CoordinatorPipelineStore;
  versionId?: string;
}

/** Options for {@link planStoredS3CoordinatorReconciliation}. */
export interface PlanStoredS3CoordinatorReconciliationOptions {
  sessionId: OlosId;
  /** Restricts the plan to these slots; omitted, every eligible slot. */
  slotIds?: readonly OlosId[];
  store: CoordinatorPipelineStore;
}

/**
 * Dry-run reconciliation result: the slots a sweep would attempt to commit
 * (`planned`), or `not_found` when the session does not exist.
 */
export type StoredS3CoordinatorReconciliationPlan =
  | {
      slotIds: readonly OlosId[];
      slots: readonly UploadSlot[];
      status: "planned";
    }
  | {
      status: "not_found";
    };

/**
 * Result of a reconciliation sweep: per-slot results in plan order
 * (`reconciled`), or `not_found` when the session does not exist.
 */
export type StoredS3CoordinatorUploadReconciliation =
  | {
      results: readonly StoredS3CoordinatorUploadReconciliationResult[];
      status: "reconciled";
    }
  | {
      status: "not_found";
    };

/**
 * Outcome of reconciling one slot: the commit it produced, or `failed` with
 * the thrown error's message and/or the unsuccessful commit result.
 */
export type StoredS3CoordinatorUploadReconciliationResult =
  | {
      commit: StoredS3CoordinatorUploadReconciliationCommit;
      slot: UploadSlot;
      status: "committed" | "idempotent";
    }
  | {
      error?: string;
      result?: StoredS3CoordinatorUploadCommit;
      slot: UploadSlot;
      status: "failed";
    };

/** Stored commit result narrowed to the successful reconciliation statuses. */
export type StoredS3CoordinatorUploadReconciliationCommit =
  StoredS3CoordinatorUploadCommit & {
    commit: Commit;
    cursor?: Cursor;
    status: "committed" | "idempotent";
  };

export type FailedStoredS3CoordinatorUploadReconciliationResult = Extract<
  StoredS3CoordinatorUploadReconciliationResult,
  { status: "failed" }
>;

export type MissingStoredS3CoordinatorUploadReconciliation = Extract<
  StoredS3CoordinatorUploadReconciliation,
  { status: "not_found" }
>;

export type MissingStoredS3CoordinatorReconciliationPlan = Extract<
  StoredS3CoordinatorReconciliationPlan,
  { status: "not_found" }
>;

/**
 * Aggregate counts for a reconciliation sweep produced by
 * {@link summarizeStoredS3CoordinatorUploadReconciliation}. `ok` is true
 * when no slot failed; `failedErrorCodes` collects the `olos.*` codes of
 * rejected commits (thrown errors contribute a slot id but no code).
 */
export interface StoredS3CoordinatorUploadReconciliationSummary {
  committed: number;
  failed: number;
  failedErrorCodes: readonly OlosErrorCode[];
  failedSlotIds: readonly OlosId[];
  idempotent: number;
  ok: boolean;
  planned: number;
  slotIds: readonly OlosId[];
  status: StoredS3CoordinatorUploadReconciliation["status"];
}

export type MutableStoredS3CoordinatorUploadReconciliationSummary = Omit<
  StoredS3CoordinatorUploadReconciliationSummary,
  "ok" | "planned" | "status"
> & {
  failedErrorCodes: OlosErrorCode[];
  failedSlotIds: OlosId[];
  slotIds: OlosId[];
};

export interface StoredS3CoordinatorUploadReconciliationSummaryContribution {
  committed: number;
  failed: number;
  failedErrorCode?: OlosErrorCode;
  failedSlotId?: OlosId;
  idempotent: number;
}

/**
 * Sweep a stored session's unresolved slots (state `issued` or
 * `upload_observed`, optionally narrowed by `slotIds`) and attempt to
 * commit each one in turn via S3 `HeadObject` observation. Commit ids
 * default to `reconcile_{slotId}`, so re-running a sweep is idempotent for
 * slots that already committed. Per-slot failures — including thrown errors
 * — are captured in the results rather than aborting the sweep. This
 * applies changes; use {@link planStoredS3CoordinatorReconciliation} for a
 * dry run.
 */
export async function reconcileStoredS3CoordinatorUploads(
  options: ReconcileStoredS3CoordinatorUploadsOptions
): Promise<StoredS3CoordinatorUploadReconciliation> {
  assertReconciliationOptions(options);

  const plan = await loadStoredS3CoordinatorReconciliationPlan(options);

  if (isMissingStoredS3CoordinatorReconciliationPlan(plan)) {
    return missingStoredS3CoordinatorUploadReconciliation();
  }

  return {
    results: await reconcileStoredS3CoordinatorUploadSlots(plan.slots, options),
    status: "reconciled",
  };
}

function assertReconciliationOptions(
  options: ReconcileStoredS3CoordinatorUploadsOptions
): void {
  assertS3BucketName(options.bucket);
  assertUrlSafeIdentifier(options.providerId, "providerId");
}

/**
 * Reduce a reconciliation result to aggregate counts and failure lists for
 * logs and HTTP responses. A `not_found` result summarizes to zero counts
 * with `ok: false`.
 */
export function summarizeStoredS3CoordinatorUploadReconciliation(
  result: StoredS3CoordinatorUploadReconciliation
): StoredS3CoordinatorUploadReconciliationSummary {
  if (isMissingStoredS3CoordinatorUploadReconciliation(result)) {
    return missingStoredS3CoordinatorUploadReconciliationSummary();
  }

  const summary = initialStoredS3CoordinatorUploadReconciliationSummary();

  for (const entry of result.results) {
    summarizeStoredS3CoordinatorUploadReconciliationEntry(summary, entry);
  }

  return completedStoredS3CoordinatorUploadReconciliationSummary(
    summary,
    result.results.length
  );
}
