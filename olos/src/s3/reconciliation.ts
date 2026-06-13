import type {
  CoordinatorCommitPolicy,
  CoordinatorPipelineStore,
} from "../protocol";
import type { PublicationControlPolicy } from "../state/publication-control";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { OlosErrorCode } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { UploadSlot } from "../types/upload-slot";
import { assertUrlSafeIdentifier } from "../validation/ids";
import {
  commitStoredS3CoordinatorUpload,
  type StoredS3CoordinatorManifestOptions,
  type StoredS3CoordinatorUploadCommit,
} from "./coordinator";
import type { S3HeadObjectClient } from "./object-observation";

type SlotValue<T> = T | ((slot: UploadSlot) => T);

export interface ReconcileStoredS3CoordinatorUploadsOptions {
  bucket: string;
  client: S3HeadObjectClient;
  commitId?: SlotValue<OlosId>;
  commitPolicy?: CoordinatorCommitPolicy;
  committedAt: SlotValue<string>;
  independent?: SlotValue<boolean | undefined>;
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

export async function reconcileStoredS3CoordinatorUploads(
  options: ReconcileStoredS3CoordinatorUploadsOptions
): Promise<StoredS3CoordinatorUploadReconciliation> {
  assertReconciliationOptions(options);

  const snapshot = await options.store.load(options.sessionId);

  if (snapshot === undefined) {
    return { status: "not_found" };
  }

  const results: StoredS3CoordinatorUploadReconciliationResult[] = [];

  for (const slot of reconciliationSlots(snapshot.state.slots, options)) {
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
  if (options.bucket.length === 0) {
    throw new Error("bucket must be a non-empty string");
  }

  assertUrlSafeIdentifier(options.providerId, "providerId");
}

export function summarizeStoredS3CoordinatorUploadReconciliation(
  result: StoredS3CoordinatorUploadReconciliation
): StoredS3CoordinatorUploadReconciliationSummary {
  if (result.status === "not_found") {
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

  const summary = {
    committed: 0,
    failed: 0,
    failedErrorCodes: [] as OlosErrorCode[],
    failedSlotIds: [] as OlosId[],
    idempotent: 0,
    slotIds: [] as OlosId[],
  };

  for (const entry of result.results) {
    summary.slotIds.push(entry.slot.slotId);

    if (entry.status === "committed") {
      summary.committed += 1;
      continue;
    }

    if (entry.status === "idempotent") {
      summary.idempotent += 1;
      continue;
    }

    if (entry.status === "failed") {
      summary.failed += 1;
      summary.failedSlotIds.push(entry.slot.slotId);

      const failedResult = entry.result;

      if (failedResult?.status === "rejected") {
        summary.failedErrorCodes.push(failedResult.error.error.code);
      }
    }
  }

  return {
    ...summary,
    ok: summary.failed === 0,
    planned: result.results.length,
    status: "reconciled",
  };
}

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
    const result = await commitStoredS3CoordinatorUpload({
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
      ...optionalField("manifest", options.manifest),
      ...optionalField("maxAttempts", options.maxAttempts),
      ...optionalField("maxSegments", options.maxSegments),
      ...optionalSlotValue("programDateTime", options.programDateTime, slot),
      ...optionalField("publicationControl", options.publicationControl),
      ...optionalField("versionId", options.versionId),
    });

    if (result.status === "committed" || result.status === "idempotent") {
      return {
        commit: result,
        slot,
        status: result.status,
      };
    }

    return {
      result,
      slot,
      status: "failed",
    };
  } catch (error) {
    return {
      error: errorMessage(error),
      slot,
      status: "failed",
    };
  }
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
      (slot.state === "issued" || slot.state === "upload_observed") &&
      (allowedIds === undefined || allowedIds.has(slot.slotId))
  );
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

  return resolved === undefined
    ? {}
    : ({ [key]: resolved } as Record<Key, Value>);
}

function optionalField<Key extends string, Value>(
  key: Key,
  value: Value | undefined
): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, Value>);
}

function commitId(slot: UploadSlot): OlosId {
  return `reconcile_${slot.slotId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "S3 reconciliation failed";
}
