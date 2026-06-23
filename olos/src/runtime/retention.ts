import {
  type CoordinatorPipelineStore,
  type CoordinatorRetentionPlan,
  planCoordinatorRetention,
} from "../protocol";
import type { OlosId } from "../types/ids";
import { assertUrlSafeIdentifier } from "../validation/ids";
import { errorMessage } from "./errors";
import { timestampMs } from "./request-fields";
import { jsonErrorResponse, jsonResponse } from "./response";

export interface DeleteRetiredCoordinatorObjectsOptions {
  deleteObject(object: RetiredCoordinatorObjectDeletion): Promise<void> | void;
  objects: readonly RetiredCoordinatorObjectDeletion[];
}

export interface PlanStoredCoordinatorRetentionOptions {
  now: string;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

export interface RetiredCoordinatorObjectDeletion {
  commitId: string;
  objectKey: string;
  slotId: string;
}

export interface RetiredCoordinatorObjectDeletionFailure {
  error: string;
  object: RetiredCoordinatorObjectDeletion;
}

export interface RetiredCoordinatorObjectDeletionResult {
  deletedObjects: readonly RetiredCoordinatorObjectDeletion[];
  failedObjects: readonly RetiredCoordinatorObjectDeletionFailure[];
}

export interface RetiredCoordinatorObjectDeletionSummary {
  deleted: number;
  failed: number;
  failedObjectKeys: readonly string[];
  failedSlotIds: readonly string[];
  ok: boolean;
  planned: number;
}

type RetiredCoordinatorObjectDeletionAttempt =
  | {
      object: RetiredCoordinatorObjectDeletion;
      status: "deleted";
    }
  | {
      failure: RetiredCoordinatorObjectDeletionFailure;
      status: "failed";
    };

interface MutableRetiredCoordinatorObjectDeletionResult {
  deletedObjects: RetiredCoordinatorObjectDeletion[];
  failedObjects: RetiredCoordinatorObjectDeletionFailure[];
}

export type StoredRuntimeRetentionPlan =
  | {
      plan: CoordinatorRetentionPlan;
      response: Response;
      status: "planned";
    }
  | {
      response: Response;
      status: "not_found";
    };

export async function deleteRetiredCoordinatorObjects(
  options: DeleteRetiredCoordinatorObjectsOptions
): Promise<RetiredCoordinatorObjectDeletionResult> {
  const result = emptyRetiredCoordinatorObjectDeletionResult();

  for (const object of options.objects) {
    const attempt = await deleteRetiredCoordinatorObject(options, object);
    recordRetiredCoordinatorObjectDeletionAttempt(result, attempt);
  }

  return result;
}

async function deleteRetiredCoordinatorObject(
  options: DeleteRetiredCoordinatorObjectsOptions,
  object: RetiredCoordinatorObjectDeletion
): Promise<RetiredCoordinatorObjectDeletionAttempt> {
  try {
    await options.deleteObject(object);

    return {
      object,
      status: "deleted",
    };
  } catch (error) {
    return {
      failure: {
        error: errorMessage(error, "retention deletion failed"),
        object,
      },
      status: "failed",
    };
  }
}

function emptyRetiredCoordinatorObjectDeletionResult(): MutableRetiredCoordinatorObjectDeletionResult {
  return {
    deletedObjects: [],
    failedObjects: [],
  };
}

function recordRetiredCoordinatorObjectDeletionAttempt(
  result: MutableRetiredCoordinatorObjectDeletionResult,
  attempt: RetiredCoordinatorObjectDeletionAttempt
): void {
  if (attempt.status === "deleted") {
    result.deletedObjects.push(attempt.object);
    return;
  }

  result.failedObjects.push(attempt.failure);
}

export function summarizeRetiredCoordinatorObjectDeletions(
  result: RetiredCoordinatorObjectDeletionResult
): RetiredCoordinatorObjectDeletionSummary {
  return {
    deleted: result.deletedObjects.length,
    failed: result.failedObjects.length,
    failedObjectKeys: result.failedObjects.map(
      (failure) => failure.object.objectKey
    ),
    failedSlotIds: result.failedObjects.map((failure) => failure.object.slotId),
    ok: result.failedObjects.length === 0,
    planned: result.deletedObjects.length + result.failedObjects.length,
  };
}

export async function planStoredCoordinatorRetention(
  options: PlanStoredCoordinatorRetentionOptions
): Promise<StoredRuntimeRetentionPlan> {
  assertStoredRetentionOptions(options);

  const snapshot = await options.store.load(options.sessionId);

  if (snapshot === undefined) {
    return {
      response: jsonErrorResponse("coordinator session was not found", 404),
      status: "not_found",
    };
  }

  const plan = planCoordinatorRetention({
    now: options.now,
    state: snapshot.state,
  });

  return {
    plan,
    response: jsonResponse({ plan }, 200),
    status: "planned",
  };
}

function assertStoredRetentionOptions(
  options: PlanStoredCoordinatorRetentionOptions
): void {
  assertUrlSafeIdentifier(options.sessionId, "sessionId");
  timestampMs(options.now, "now");
}
