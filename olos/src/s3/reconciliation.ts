import type {
  CoordinatorCommitPolicy,
  CoordinatorPipelineStore,
} from "../protocol";
import { errorMessage } from "../runtime/errors";
import { optionalField } from "../runtime/optional-field";
import { isStringLiteral } from "../runtime/string-literals";
import type { PublicationControlPolicy } from "../state/publication-control";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { OlosErrorCode } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { UploadSlot } from "../types/upload-slot";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { assertS3BucketName } from "./bucket";
import {
  type CommitStoredS3CoordinatorUploadOptions,
  commitStoredS3CoordinatorUpload,
  type StoredS3CoordinatorManifestOptions,
  type StoredS3CoordinatorUploadCommit,
} from "./coordinator";
import type { S3HeadObjectClient } from "./object-observation";

type SlotValue<T> = T | ((slot: UploadSlot) => T);
type ReconciliationUploadSlot = UploadSlot & {
  state: "issued" | "upload_observed";
};
const SUCCESSFUL_S3_RECONCILIATION_STATUSES = [
  "committed",
  "idempotent",
] as const;

type SuccessfulS3ReconciliationStatus =
  (typeof SUCCESSFUL_S3_RECONCILIATION_STATUSES)[number];

type RejectedS3CoordinatorUploadCommit = Extract<
  StoredS3CoordinatorUploadCommit,
  { status: "rejected" }
>;

export interface ReconcileStoredS3CoordinatorUploadsOptions {
  bucket: string;
  client: S3HeadObjectClient;
  commitId?: SlotValue<OlosId>;
  commitPolicy?: CoordinatorCommitPolicy;
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
  slotIds?: readonly OlosId[];
  store: CoordinatorPipelineStore;
  versionId?: string;
}

export interface PlanStoredS3CoordinatorReconciliationOptions {
  sessionId: OlosId;
  slotIds?: readonly OlosId[];
  store: CoordinatorPipelineStore;
}

export type StoredS3CoordinatorReconciliationPlan =
  | {
      slotIds: readonly OlosId[];
      slots: readonly UploadSlot[];
      status: "planned";
    }
  | {
      status: "not_found";
    };

export type StoredS3CoordinatorUploadReconciliation =
  | {
      results: readonly StoredS3CoordinatorUploadReconciliationResult[];
      status: "reconciled";
    }
  | {
      status: "not_found";
    };

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

export type StoredS3CoordinatorUploadReconciliationCommit =
  StoredS3CoordinatorUploadCommit & {
    commit: Commit;
    cursor?: Cursor;
    status: "committed" | "idempotent";
  };

type FailedStoredS3CoordinatorUploadReconciliationResult = Extract<
  StoredS3CoordinatorUploadReconciliationResult,
  { status: "failed" }
>;

type MissingStoredS3CoordinatorUploadReconciliation = Extract<
  StoredS3CoordinatorUploadReconciliation,
  { status: "not_found" }
>;

type MissingStoredS3CoordinatorReconciliationPlan = Extract<
  StoredS3CoordinatorReconciliationPlan,
  { status: "not_found" }
>;

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

type MutableStoredS3CoordinatorUploadReconciliationSummary = Omit<
  StoredS3CoordinatorUploadReconciliationSummary,
  "ok" | "planned" | "status"
> & {
  failedErrorCodes: OlosErrorCode[];
  failedSlotIds: OlosId[];
  slotIds: OlosId[];
};

export async function reconcileStoredS3CoordinatorUploads(
  options: ReconcileStoredS3CoordinatorUploadsOptions
): Promise<StoredS3CoordinatorUploadReconciliation> {
  assertReconciliationOptions(options);

  const plan = await loadStoredS3CoordinatorReconciliationPlan(options);

  if (isMissingStoredS3CoordinatorReconciliationPlan(plan)) {
    return missingStoredS3CoordinatorUploadReconciliation();
  }

  const results: StoredS3CoordinatorUploadReconciliationResult[] = [];

  for (const slot of plan.slots) {
    results.push(await reconcileSlot(slot, options));
  }

  return {
    results,
    status: "reconciled",
  };
}

function assertReconciliationOptions(
  options: ReconcileStoredS3CoordinatorUploadsOptions
): void {
  assertS3BucketName(options.bucket);
  assertUrlSafeIdentifier(options.providerId, "providerId");
}

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

function missingStoredS3CoordinatorUploadReconciliationSummary(): StoredS3CoordinatorUploadReconciliationSummary {
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

function initialStoredS3CoordinatorUploadReconciliationSummary(): MutableStoredS3CoordinatorUploadReconciliationSummary {
  return {
    committed: 0,
    failed: 0,
    failedErrorCodes: [],
    failedSlotIds: [],
    idempotent: 0,
    slotIds: [],
  };
}

function summarizeStoredS3CoordinatorUploadReconciliationEntry(
  summary: MutableStoredS3CoordinatorUploadReconciliationSummary,
  entry: StoredS3CoordinatorUploadReconciliationResult
): void {
  summary.slotIds.push(entry.slot.slotId);

  switch (entry.status) {
    case "committed":
      summarizeCommittedStoredS3CoordinatorUploadReconciliationEntry(summary);
      return;
    case "idempotent":
      summarizeIdempotentStoredS3CoordinatorUploadReconciliationEntry(summary);
      return;
    case "failed":
      summarizeFailedStoredS3CoordinatorUploadReconciliationEntry(
        summary,
        entry
      );
      return;
    default:
      return;
  }
}

function summarizeCommittedStoredS3CoordinatorUploadReconciliationEntry(
  summary: MutableStoredS3CoordinatorUploadReconciliationSummary
): void {
  summary.committed += 1;
}

function summarizeIdempotentStoredS3CoordinatorUploadReconciliationEntry(
  summary: MutableStoredS3CoordinatorUploadReconciliationSummary
): void {
  summary.idempotent += 1;
}

function summarizeFailedStoredS3CoordinatorUploadReconciliationEntry(
  summary: MutableStoredS3CoordinatorUploadReconciliationSummary,
  entry: FailedStoredS3CoordinatorUploadReconciliationResult
): void {
  summary.failed += 1;
  summary.failedSlotIds.push(entry.slot.slotId);

  const failedResult = entry.result;

  if (isRejectedS3CoordinatorUploadCommit(failedResult)) {
    summary.failedErrorCodes.push(failedResult.error.error.code);
  }
}

function completedStoredS3CoordinatorUploadReconciliationSummary(
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

export function planStoredS3CoordinatorReconciliation(
  options: PlanStoredS3CoordinatorReconciliationOptions
): Promise<StoredS3CoordinatorReconciliationPlan> {
  return loadStoredS3CoordinatorReconciliationPlan(options);
}

async function loadStoredS3CoordinatorReconciliationPlan(
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
    ...optionalSlotValue("independent", options.independent, slot),
    ...optionalSlotValue("lateToleranceMs", options.lateToleranceMs, slot),
    ...optionalField("manifest", options.manifest),
    ...optionalField("maxAttempts", options.maxAttempts),
    ...optionalField("maxSegments", options.maxSegments),
    ...optionalSlotValue("programDateTime", options.programDateTime, slot),
    ...optionalField("publicationControl", options.publicationControl),
    ...optionalField("versionId", options.versionId),
  };
}

function missingStoredS3CoordinatorUploadReconciliation(): MissingStoredS3CoordinatorUploadReconciliation {
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
  return isStringLiteral(result.status, SUCCESSFUL_S3_RECONCILIATION_STATUSES);
}

function isRejectedS3CoordinatorUploadCommit(
  result: StoredS3CoordinatorUploadCommit | undefined
): result is RejectedS3CoordinatorUploadCommit {
  return result?.status === "rejected";
}

function isMissingStoredS3CoordinatorUploadReconciliation(
  result: StoredS3CoordinatorUploadReconciliation
): result is MissingStoredS3CoordinatorUploadReconciliation {
  return result.status === "not_found";
}

function isMissingStoredS3CoordinatorReconciliationPlan(
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

function commitId(slot: UploadSlot): OlosId {
  return `reconcile_${slot.slotId}`;
}
