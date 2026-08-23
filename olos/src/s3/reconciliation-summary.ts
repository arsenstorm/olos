import { optionalField } from "../runtime/request-fields";
import type { OlosId } from "../types/ids";
import type { UploadSlot } from "../types/upload-slot";
import { isAllowedString } from "../validation/fields";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertS3BucketName } from "./bucket";
import { commitStoredS3CoordinatorUpload } from "./coordinator-grant";
import type {
  CommitStoredS3CoordinatorUploadOptions,
  StoredS3CoordinatorUploadCommit,
} from "./coordinator-types";
import type {
  FailedStoredS3CoordinatorUploadReconciliationResult,
  MutableStoredS3CoordinatorUploadReconciliationSummary,
  PlanStoredS3CoordinatorReconciliationOptions,
  ReconcileStoredS3CoordinatorUploadsOptions,
  ReconciliationUploadSlot,
  RejectedS3CoordinatorUploadCommit,
  SlotValue,
  StoredS3CoordinatorReconciliationPlan,
  StoredS3CoordinatorUploadReconciliation,
  StoredS3CoordinatorUploadReconciliationResult,
  StoredS3CoordinatorUploadReconciliationSummary,
  StoredS3CoordinatorUploadReconciliationSummaryContribution,
} from "./reconciliation";

export const SUCCESSFUL_S3_RECONCILIATION_STATUSES = [
  "committed",
  "idempotent",
] as const;

export type SuccessfulS3ReconciliationStatus =
  (typeof SUCCESSFUL_S3_RECONCILIATION_STATUSES)[number];

export function missingStoredS3CoordinatorUploadReconciliationSummary(): StoredS3CoordinatorUploadReconciliationSummary {
  return {
    committed: 0,
    failed: 0,
    failedErrorCodes: [],
    failedSlotIds: [],
    idempotent: 0,
    ok: false,
    planned: 0,
    slotIds: [],
    status: "not_found",
  };
}

export function initialStoredS3CoordinatorUploadReconciliationSummary(): MutableStoredS3CoordinatorUploadReconciliationSummary {
  return {
    committed: 0,
    failed: 0,
    failedErrorCodes: [],
    failedSlotIds: [],
    idempotent: 0,
    slotIds: [],
  };
}

export function summarizeStoredS3CoordinatorUploadReconciliationEntry(
  summary: MutableStoredS3CoordinatorUploadReconciliationSummary,
  entry: StoredS3CoordinatorUploadReconciliationResult
): void {
  const contribution =
    storedS3CoordinatorUploadReconciliationSummaryContribution(entry);

  summary.slotIds.push(entry.slot.slotId);
  summary.committed += contribution.committed;
  summary.failed += contribution.failed;
  summary.idempotent += contribution.idempotent;

  if (contribution.failedSlotId !== undefined) {
    summary.failedSlotIds.push(contribution.failedSlotId);
  }

  if (contribution.failedErrorCode !== undefined) {
    summary.failedErrorCodes.push(contribution.failedErrorCode);
  }
}

function storedS3CoordinatorUploadReconciliationSummaryContribution(
  entry: StoredS3CoordinatorUploadReconciliationResult
): StoredS3CoordinatorUploadReconciliationSummaryContribution {
  switch (entry.status) {
    case "committed":
      return reconciliationSummaryContribution({ committed: 1 });
    case "idempotent":
      return reconciliationSummaryContribution({ idempotent: 1 });
    case "failed":
      return failedStoredS3CoordinatorUploadReconciliationSummaryContribution(
        entry
      );
    default:
      return reconciliationSummaryContribution();
  }
}

function failedStoredS3CoordinatorUploadReconciliationSummaryContribution(
  entry: FailedStoredS3CoordinatorUploadReconciliationResult
): StoredS3CoordinatorUploadReconciliationSummaryContribution {
  const failedResult = entry.result;

  if (isRejectedS3CoordinatorUploadCommit(failedResult)) {
    return reconciliationSummaryContribution({
      failed: 1,
      failedErrorCode: failedResult.error.error.code,
      failedSlotId: entry.slot.slotId,
    });
  }

  return reconciliationSummaryContribution({
    failed: 1,
    failedSlotId: entry.slot.slotId,
  });
}

function reconciliationSummaryContribution(
  contribution: Partial<StoredS3CoordinatorUploadReconciliationSummaryContribution> = {}
): StoredS3CoordinatorUploadReconciliationSummaryContribution {
  return {
    committed: contribution.committed ?? 0,
    failed: contribution.failed ?? 0,
    failedErrorCode: contribution.failedErrorCode,
    failedSlotId: contribution.failedSlotId,
    idempotent: contribution.idempotent ?? 0,
  };
}

export function completedStoredS3CoordinatorUploadReconciliationSummary(
  summary: MutableStoredS3CoordinatorUploadReconciliationSummary,
  planned: number
): StoredS3CoordinatorUploadReconciliationSummary {
  return {
    ...summary,
    ok: summary.failed === 0,
    planned,
    status: "reconciled",
  };
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

  const plan = await planStoredS3CoordinatorReconciliation(options);

  if (plan.status === "not_found") {
    return { status: "not_found" };
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
 * Dry-run counterpart of {@link reconcileStoredS3CoordinatorUploads}:
 * report which slots a sweep would attempt to commit without observing S3
 * objects or mutating stored state. Returns `not_found` when the session
 * does not exist.
 */
export async function planStoredS3CoordinatorReconciliation(
  options: PlanStoredS3CoordinatorReconciliationOptions
): Promise<StoredS3CoordinatorReconciliationPlan> {
  const snapshot = await options.store.load(options.sessionId);

  if (snapshot === undefined) {
    return { status: "not_found" };
  }

  const slots = reconciliationSlots(snapshot.state.slots, options);

  return {
    slotIds: slots.map((slot) => slot.slotId),
    slots,
    status: "planned",
  };
}

async function reconcileSlot(
  slot: UploadSlot,
  options: ReconcileStoredS3CoordinatorUploadsOptions
): Promise<StoredS3CoordinatorUploadReconciliationResult> {
  try {
    const result = await commitStoredS3CoordinatorUpload(
      reconciliationCommitOptions(slot, options)
    );

    if (isSuccessfulS3ReconciliationCommit(result)) {
      return {
        commit: result,
        slot,
        status: result.status,
      };
    }

    return failedStoredS3CoordinatorUploadReconciliationResult(slot, result);
  } catch (error) {
    options.onError?.(error);
    return failedStoredS3CoordinatorUploadReconciliationError(slot);
  }
}

export async function reconcileStoredS3CoordinatorUploadSlots(
  slots: readonly UploadSlot[],
  options: ReconcileStoredS3CoordinatorUploadsOptions
): Promise<StoredS3CoordinatorUploadReconciliationResult[]> {
  const results: StoredS3CoordinatorUploadReconciliationResult[] = [];

  for (const slot of slots) {
    // biome-ignore lint/performance/noAwaitInLoops: each slot reconciliation commits against the coordinator snapshot the previous one saved, so concurrent commits race the etag.
    results.push(await reconcileSlot(slot, options));
  }

  return results;
}

function reconciliationCommitOptions(
  slot: UploadSlot,
  options: ReconcileStoredS3CoordinatorUploadsOptions
): CommitStoredS3CoordinatorUploadOptions {
  return {
    bucket: options.bucket,
    client: options.client,
    commitId: resolveSlotValue(options.commitId, slot) ?? commitId(slot),
    commitPolicy: options.commitPolicy,
    committedAt: resolveSlotValue(options.committedAt, slot),
    providerId: options.providerId,
    sessionId: options.sessionId,
    slotId: slot.slotId,
    store: options.store,
    ...optionalSlotValue("lateToleranceMs", options.lateToleranceMs, slot),
    ...optionalField("manifest", options.manifest),
    ...optionalField("maxAttempts", options.maxAttempts),
    ...optionalField("maxSegments", options.maxSegments),
    ...optionalSlotValue("profile", options.profile, slot),
    ...optionalField("publicationControl", options.publicationControl),
    ...optionalField("versionId", options.versionId),
  };
}

function failedStoredS3CoordinatorUploadReconciliationResult(
  slot: UploadSlot,
  result: StoredS3CoordinatorUploadCommit
): FailedStoredS3CoordinatorUploadReconciliationResult {
  return {
    result,
    slot,
    status: "failed",
  };
}

function failedStoredS3CoordinatorUploadReconciliationError(
  slot: UploadSlot
): FailedStoredS3CoordinatorUploadReconciliationResult {
  return {
    error: "S3 reconciliation failed",
    slot,
    status: "failed",
  };
}

function isSuccessfulS3ReconciliationCommit<
  Result extends StoredS3CoordinatorUploadCommit,
>(
  result: Result
): result is Extract<Result, { status: SuccessfulS3ReconciliationStatus }> {
  return isAllowedString(result.status, SUCCESSFUL_S3_RECONCILIATION_STATUSES);
}

function isRejectedS3CoordinatorUploadCommit(
  result: StoredS3CoordinatorUploadCommit | undefined
): result is RejectedS3CoordinatorUploadCommit {
  return result?.status === "rejected";
}

function reconciliationSlots(
  slots: readonly UploadSlot[],
  options: {
    slotIds?: readonly OlosId[];
  }
): UploadSlot[] {
  const allowedIds =
    options.slotIds === undefined ? undefined : new Set(options.slotIds);

  return slots.filter(
    (slot) =>
      isReconciliationUploadSlot(slot) && isAllowedSlot(slot, allowedIds)
  );
}

function isReconciliationUploadSlot(
  slot: UploadSlot
): slot is ReconciliationUploadSlot {
  return slot.state === "issued" || slot.state === "upload_observed";
}

function isAllowedSlot(
  slot: UploadSlot,
  allowedIds: ReadonlySet<OlosId> | undefined
): boolean {
  return allowedIds === undefined || allowedIds.has(slot.slotId);
}

function resolveSlotValue<T>(value: SlotValue<T>, slot: UploadSlot): T {
  return typeof value === "function"
    ? (value as (slot: UploadSlot) => T)(slot)
    : value;
}

function optionalSlotValue<Key extends string, Value>(
  key: Key,
  value: SlotValue<Value | undefined> | undefined,
  slot: UploadSlot
): Partial<Record<Key, Value>> {
  const resolved = resolveSlotValue(value, slot);

  return optionalField(key, resolved);
}

export function commitId(slot: UploadSlot): OlosId {
  return `reconcile_${slot.slotId}`;
}
