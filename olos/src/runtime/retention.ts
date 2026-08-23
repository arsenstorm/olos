import { planCoordinatorRetention } from "../protocol/coordinator-lifecycle";
import {
  applyCoordinatorRetention,
  type CoordinatorRetentionApplication,
} from "../protocol/coordinator-retention";
import type {
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineState,
  CoordinatorPipelineStore,
  CoordinatorRetentionPlan,
} from "../protocol/coordinator-types";
import { runStoredCoordinatorMutationWithAdaptersAndResponse } from "../protocol/mutate-coordinator-store";
import type { OlosId } from "../types/ids";
import { errorMessage } from "../validation/fields";
import {
  assertPositiveInteger,
  assertUrlSafeIdentifier,
} from "../validation/ids";
import { timestampMs } from "./request-fields";
import { jsonConflictResponse, jsonResponse } from "./response";
import { notFound } from "./session-state";

/** Options for `applyStoredCoordinatorRetention`. */
export interface ApplyStoredCoordinatorRetentionOptions
  extends PlanStoredCoordinatorRetentionOptions {
  /** Max optimistic-save attempts; defaults to 2. */
  maxAttempts?: number;
}

/** Options for `deleteRetiredCoordinatorObjects`. */
export interface DeleteRetiredCoordinatorObjectsOptions {
  /** Max deletes in flight at once; defaults to 1 (sequential). */
  concurrency?: number;
  /** Deletes one object from storage; a throw marks that object failed. */
  deleteObject(object: RetiredCoordinatorObjectDeletion): Promise<void> | void;
  objects: readonly RetiredCoordinatorObjectDeletion[];
}

/** Options for `planStoredCoordinatorRetention`. */
export interface PlanStoredCoordinatorRetentionOptions {
  /**
   * Grace period in milliseconds added to each slot's `expiresAt` before it
   * counts as expired; defaults to 0. Match it to the commit path's
   * `lateToleranceMs` so a sweep never prunes a slot whose late upload
   * would still commit.
   */
  lateToleranceMs?: number;
  /** Time retention is evaluated at, as an ISO 8601 timestamp. */
  now: string;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

/** A retired object slated for deletion from object storage. */
export interface RetiredCoordinatorObjectDeletion {
  commitId: string;
  objectKey: string;
  slotId: string;
}

/** One object whose deletion failed, with the failure message. */
export interface RetiredCoordinatorObjectDeletionFailure {
  error: string;
  object: RetiredCoordinatorObjectDeletion;
}

/**
 * Result of `deleteRetiredCoordinatorObjects`, partitioned into deleted and
 * failed objects. Both arrays preserve the input order.
 */
export interface RetiredCoordinatorObjectDeletionResult {
  deletedObjects: readonly RetiredCoordinatorObjectDeletion[];
  failedObjects: readonly RetiredCoordinatorObjectDeletionFailure[];
}

/** Aggregate counts of a deletion run, convenient for logs and metrics. */
export interface RetiredCoordinatorObjectDeletionSummary {
  deleted: number;
  failed: number;
  failedObjectKeys: readonly string[];
  failedSlotIds: readonly string[];
  /** `true` when no deletion failed. */
  ok: boolean;
  /** Total objects attempted (`deleted + failed`). */
  planned: number;
}

interface MutableRetiredCoordinatorObjectDeletionResult {
  deletedObjects: RetiredCoordinatorObjectDeletion[];
  failedObjects: RetiredCoordinatorObjectDeletionFailure[];
}

/**
 * Outcome of `planStoredCoordinatorRetention`: `planned` with the plan, or
 * `not_found` when the session does not exist. Both variants carry a
 * ready-to-return JSON `response`.
 */
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

/**
 * Outcome of `applyStoredCoordinatorRetention`. `applied` carries the
 * pruned state and its new etag; `unchanged` means the plan removed nothing
 * and no store save was performed; `conflict` means concurrent writes
 * exhausted the optimistic retries; `not_found` means the session does not
 * exist. Every variant carries a ready-to-return JSON `response` (the
 * `applied` and `unchanged` responses are identical 200s with the plan).
 */
export type StoredRuntimeRetentionApplication =
  | {
      etag: string;
      plan: CoordinatorRetentionPlan;
      response: Response;
      state: CoordinatorPipelineState;
      status: "applied";
    }
  | {
      plan: CoordinatorRetentionPlan;
      response: Response;
      status: "unchanged";
    }
  | {
      current?: CoordinatorPipelineSnapshot;
      response: Response;
      status: "conflict";
    }
  | {
      response: Response;
      status: "not_found";
    };

type RetiredCoordinatorObjectDeletionOutcome =
  | {
      object: RetiredCoordinatorObjectDeletion;
      status: "deleted";
    }
  | {
      failure: RetiredCoordinatorObjectDeletionFailure;
      status: "failed";
    };

/**
 * Delete retired objects through the `deleteObject` callback, running at
 * most `concurrency` deletes at once (default 1). Each failure is isolated
 * to its own object — the run always completes and reports per-object
 * outcomes, in input order, rather than throwing.
 */
export async function deleteRetiredCoordinatorObjects(
  options: DeleteRetiredCoordinatorObjectsOptions
): Promise<RetiredCoordinatorObjectDeletionResult> {
  const concurrency = options.concurrency ?? 1;

  assertPositiveInteger(concurrency, "concurrency");

  // Outcomes are recorded by input position so the result arrays keep
  // input order regardless of completion order.
  const outcomes: RetiredCoordinatorObjectDeletionOutcome[] = new Array(
    options.objects.length
  );
  const queue = options.objects.map((object, index) => ({ index, object }));
  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        outcomes[next.index] = await deleteRetiredCoordinatorObject(
          options,
          next.object
        );
      }
    }
  );

  await Promise.all(workers);

  return collectRetiredCoordinatorObjectDeletions(outcomes);
}

async function deleteRetiredCoordinatorObject(
  options: Pick<DeleteRetiredCoordinatorObjectsOptions, "deleteObject">,
  object: RetiredCoordinatorObjectDeletion
): Promise<RetiredCoordinatorObjectDeletionOutcome> {
  try {
    await options.deleteObject(object);
    return { object, status: "deleted" };
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

function collectRetiredCoordinatorObjectDeletions(
  outcomes: readonly RetiredCoordinatorObjectDeletionOutcome[]
): RetiredCoordinatorObjectDeletionResult {
  const result: MutableRetiredCoordinatorObjectDeletionResult = {
    deletedObjects: [],
    failedObjects: [],
  };

  for (const outcome of outcomes) {
    if (outcome.status === "deleted") {
      result.deletedObjects.push(outcome.object);
    } else {
      result.failedObjects.push(outcome.failure);
    }
  }

  return result;
}

/**
 * Reduce a deletion result to counts and the failed object keys / slot ids,
 * with `ok` set when nothing failed.
 */
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

/**
 * Compute a session's retention plan — the slots expired and objects
 * retired as of `now` — from the stored snapshot. Read-only: the store is
 * never written and nothing is deleted; pair with
 * `deleteRetiredCoordinatorObjects` and `applyStoredCoordinatorRetention`
 * to act on the plan.
 */
export async function planStoredCoordinatorRetention(
  options: PlanStoredCoordinatorRetentionOptions
): Promise<StoredRuntimeRetentionPlan> {
  assertStoredRetentionOptions(options);

  const snapshot = await options.store.load(options.sessionId);

  if (snapshot === undefined) {
    return notFound();
  }

  const plan = planCoordinatorRetention({
    lateToleranceMs: options.lateToleranceMs,
    now: options.now,
    state: snapshot.state,
  });

  return storedRetentionPlanned(plan);
}

/**
 * Prune expired slots and out-of-window commits from the stored snapshot
 * and persist the pruned state, so idle or ended sessions stop accumulating
 * issued slots and retired commits between commits. Unlike
 * `planStoredCoordinatorRetention` this mutates the store — via
 * optimistic-retry against the snapshot's etag (up to `maxAttempts`,
 * default 2) — but when the plan changes nothing the save is skipped
 * entirely and the result is `unchanged`, so periodic sweeps don't churn
 * etags. The cursor is never moved by pruning.
 */
export async function applyStoredCoordinatorRetention(
  options: ApplyStoredCoordinatorRetentionOptions
): Promise<StoredRuntimeRetentionApplication> {
  assertStoredRetentionOptions(options);

  return await runStoredCoordinatorMutationWithAdaptersAndResponse<
    CoordinatorRetentionApplication,
    CoordinatorRetentionApplication,
    StoredRuntimeRetentionApplication
  >({
    decide: (applied, snapshot) =>
      applied.state === snapshot.state
        ? { result: storedRetentionUnchanged(applied), status: "terminal" }
        : { attempt: applied, state: applied.state, status: "save" },
    mapSaved: (saved, applied) => storedRetentionApplied(saved, applied),
    maxAttempts: options.maxAttempts,
    mutate: (state) =>
      applyCoordinatorRetention({
        lateToleranceMs: options.lateToleranceMs,
        now: options.now,
        state,
      }),
    onConflictOrExhausted: (current) => storedRetentionConflict(current),
    onMissing: notFound,
    sessionId: options.sessionId,
    store: options.store,
  });
}

function storedRetentionApplied(
  saved: { etag: string; state: CoordinatorPipelineState },
  applied: CoordinatorRetentionApplication
): StoredRuntimeRetentionApplication {
  const plan = appliedCoordinatorRetentionPlan(applied);

  return {
    etag: saved.etag,
    plan,
    response: jsonResponse({ plan }, 200),
    state: saved.state,
    status: "applied",
  };
}

function storedRetentionUnchanged(
  applied: CoordinatorRetentionApplication
): StoredRuntimeRetentionApplication {
  const plan = appliedCoordinatorRetentionPlan(applied);

  return {
    plan,
    response: jsonResponse({ plan }, 200),
    status: "unchanged",
  };
}

function storedRetentionConflict(
  current: CoordinatorPipelineSnapshot | undefined
): StoredRuntimeRetentionApplication {
  return {
    ...(current === undefined ? {} : { current }),
    response: jsonConflictResponse(
      "coordinator session changed during retention"
    ),
    status: "conflict",
  };
}

// Pruning never moves the cursor, so the applied plan mirrors
// planCoordinatorRetention's shape with the (unchanged) cursor attached.
function appliedCoordinatorRetentionPlan(
  applied: CoordinatorRetentionApplication
): CoordinatorRetentionPlan {
  return {
    expiredSlots: applied.expiredSlots,
    retiredObjects: applied.retiredObjects,
    ...(applied.state.cursor === undefined
      ? {}
      : { cursor: applied.state.cursor }),
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
