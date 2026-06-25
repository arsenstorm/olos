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

const RETENTION_SESSION_NOT_FOUND_MESSAGE = "coordinator session was not found";

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
  const result: MutableRetiredCoordinatorObjectDeletionResult = {
    deletedObjects: [],
    failedObjects: [],
  };

  for (const object of options.objects) {
    try {
      await options.deleteObject(object);
      result.deletedObjects.push(object);
    } catch (error) {
      result.failedObjects.push({
        error: errorMessage(error, "retention deletion failed"),
        object,
      });
    }
  }

  return result;
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
    return storedRetentionNotFound();
  }

  const plan = planCoordinatorRetention({
    now: options.now,
    state: snapshot.state,
  });

  return storedRetentionPlanned(plan);
}

function storedRetentionNotFound(): StoredRuntimeRetentionPlan {
  return {
    response: jsonErrorResponse(RETENTION_SESSION_NOT_FOUND_MESSAGE, 404),
    status: "not_found",
  };
}

function storedRetentionPlanned(
  plan: CoordinatorRetentionPlan
): StoredRuntimeRetentionPlan {
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
