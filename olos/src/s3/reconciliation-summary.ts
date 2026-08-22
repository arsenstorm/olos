import { optionalField } from "../runtime/request-fields";
import type { OlosId } from "../types/ids";
import type { UploadSlot } from "../types/upload-slot";
import { errorMessage, isAllowedString } from "../validation/fields";
import { commitStoredS3CoordinatorUpload } from "./coordinator-grant";
import type {
  CommitStoredS3CoordinatorUploadOptions,
  StoredS3CoordinatorUploadCommit,
} from "./coordinator-types";
import {
  type FailedStoredS3CoordinatorUploadReconciliationResult,
  type MissingStoredS3CoordinatorReconciliationPlan,
  type MissingStoredS3CoordinatorUploadReconciliation,
  type MutableStoredS3CoordinatorUploadReconciliationSummary,
  type PlanStoredS3CoordinatorReconciliationOptions,
  type ReconcileStoredS3CoordinatorUploadsOptions,
  type ReconciliationUploadSlot,
  type RejectedS3CoordinatorUploadCommit,
  reconcileStoredS3CoordinatorUploads,
  type SlotValue,
  type StoredS3CoordinatorReconciliationPlan,
  type StoredS3CoordinatorUploadReconciliation,
  type StoredS3CoordinatorUploadReconciliationResult,
  type StoredS3CoordinatorUploadReconciliationSummary,
  type StoredS3CoordinatorUploadReconciliationSummaryContribution,
  SUCCESSFUL_S3_RECONCILIATION_STATUSES,
  type SuccessfulS3ReconciliationStatus,
} from "./reconciliation";
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
 * Dry-run counterpart of {@link reconcileStoredS3CoordinatorUploads}:
 * report which slots a sweep would attempt to commit without observing S3
 * objects or mutating stored state. Returns `not_found` when the session
 * does not exist.
 */
export function planStoredS3CoordinatorReconciliation(
  options: PlanStoredS3CoordinatorReconciliationOptions
): Promise<StoredS3CoordinatorReconciliationPlan> {
  return loadStoredS3CoordinatorReconciliationPlan(options);
}

export async function loadStoredS3CoordinatorReconciliationPlan(
  options: PlanStoredS3CoordinatorReconciliationOptions
): Promise<StoredS3CoordinatorReconciliationPlan> {
  const snapshot = await options.store.load(options.sessionId);

  if (snapshot === undefined) {
    return missingStoredS3CoordinatorReconciliationPlan();
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
    return failedStoredS3CoordinatorUploadReconciliationError(slot, error);
  }
}

export async function reconcileStoredS3CoordinatorUploadSlots(
  slots: readonly UploadSlot[],
  options: ReconcileStoredS3CoordinatorUploadsOptions
): Promise<StoredS3CoordinatorUploadReconciliationResult[]> {
  const results: StoredS3CoordinatorUploadReconciliationResult[] = [];

  for (const slot of slots) {
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
    committedAt: resolveRequiredSlotValue(options.committedAt, slot),
    commitPolicy: options.commitPolicy,
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

export function missingStoredS3CoordinatorUploadReconciliation(): MissingStoredS3CoordinatorUploadReconciliation {
  return { status: "not_found" };
}

function missingStoredS3CoordinatorReconciliationPlan(): MissingStoredS3CoordinatorReconciliationPlan {
  return { status: "not_found" };
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
  slot: UploadSlot,
  error: unknown
): FailedStoredS3CoordinatorUploadReconciliationResult {
  return {
    error: errorMessage(error, "S3 reconciliation failed"),
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

export function isMissingStoredS3CoordinatorUploadReconciliation(
  result: StoredS3CoordinatorUploadReconciliation
): result is MissingStoredS3CoordinatorUploadReconciliation {
  return result.status === "not_found";
}

export function isMissingStoredS3CoordinatorReconciliationPlan(
  plan: StoredS3CoordinatorReconciliationPlan
): plan is MissingStoredS3CoordinatorReconciliationPlan {
  return plan.status === "not_found";
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

function resolveSlotValue<T>(
  value: SlotValue<T> | undefined,
  slot: UploadSlot
): T | undefined {
  return typeof value === "function"
    ? (value as (slot: UploadSlot) => T)(slot)
    : value;
}

function resolveRequiredSlotValue<T>(value: SlotValue<T>, slot: UploadSlot): T {
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
