import {
  type CoordinatorPipelineStore,
  type CoordinatorRetentionPlan,
  planCoordinatorRetention,
} from "../protocol";
import type { OlosId } from "../types/ids";

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
  const deletedObjects: RetiredCoordinatorObjectDeletion[] = [];
  const failedObjects: RetiredCoordinatorObjectDeletionFailure[] = [];

  for (const object of options.objects) {
    try {
      await options.deleteObject(object);
      deletedObjects.push(object);
    } catch (error) {
      failedObjects.push({
        error: errorMessage(error),
        object,
      });
    }
  }

  return {
    deletedObjects,
    failedObjects,
  };
}

export async function planStoredCoordinatorRetention(
  options: PlanStoredCoordinatorRetentionOptions
): Promise<StoredRuntimeRetentionPlan> {
  const snapshot = await options.store.load(options.sessionId);

  if (snapshot === undefined) {
    return {
      response: jsonResponse(
        { error: { message: "coordinator session was not found" } },
        404
      ),
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

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "retention deletion failed";
}
