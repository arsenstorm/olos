import type { OlosId } from "../types/ids";
import { assertPositiveInteger } from "../validation/ids";
import { parseCoordinatorPipelineSnapshot } from "./coordinator-snapshot";
import type {
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineState,
  CoordinatorPipelineStore,
} from "./coordinator-types";

type CoordinatorPipelineMutationResult = Awaited<
  ReturnType<CoordinatorPipelineStore["save"]>
>;

export type SavedCoordinatorPipelineResult = Extract<
  CoordinatorPipelineMutationResult,
  { status: "saved" }
>;

// Terminal results carry TResult directly, so callers map them where they
// are produced and no separate mapTerminal hook is needed.
export type StoredMutationDecision<TSaveAttempt, TResult> =
  | {
      attempt: TSaveAttempt;
      state: CoordinatorPipelineState;
      status: "save";
    }
  | {
      result: Promise<TResult> | TResult;
      status: "terminal";
    };

type StoredMutationAttemptProgress<TResult> =
  | {
      result: TResult;
      status: "complete";
    }
  | {
      snapshot: CoordinatorPipelineSnapshot;
      status: "retry";
    };

export interface RunStoredMutationOptions<
  TAttempt,
  TSaveAttempt extends TAttempt,
  TResult,
> {
  attempts: number;
  decide: (
    attempt: TAttempt,
    snapshot: CoordinatorPipelineSnapshot
  ) => StoredMutationDecision<TSaveAttempt, TResult>;
  mutate: (state: CoordinatorPipelineState) => TAttempt | Promise<TAttempt>;
  onConflict: (
    current: CoordinatorPipelineSnapshot | undefined,
    attempt: TAttempt
  ) => Promise<TResult> | TResult;
  onExhausted: (
    snapshot: CoordinatorPipelineSnapshot
  ) => Promise<TResult> | TResult;
  onMissing: () => Promise<TResult> | TResult;
  onSaved: (
    saved: SavedCoordinatorPipelineResult,
    attempt: TSaveAttempt,
    snapshot: CoordinatorPipelineSnapshot
  ) => Promise<TResult> | TResult;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

export interface RunStoredMutationAdapterOptions<
  TAttempt,
  TSaveAttempt extends TAttempt,
  TResult,
> {
  attempts: number;
  decide: (
    attempt: TAttempt,
    snapshot: CoordinatorPipelineSnapshot
  ) => StoredMutationDecision<TSaveAttempt, TResult>;
  mapSaved: (
    saved: SavedCoordinatorPipelineResult,
    attempt: TSaveAttempt,
    snapshot: CoordinatorPipelineSnapshot
  ) => Promise<TResult> | TResult;
  mutate: (state: CoordinatorPipelineState) => TAttempt | Promise<TAttempt>;
  onConflict: (
    current: CoordinatorPipelineSnapshot | undefined,
    attempt: TAttempt
  ) => Promise<TResult> | TResult;
  onExhausted: (
    snapshot: CoordinatorPipelineSnapshot
  ) => Promise<TResult> | TResult;
  onMissing: () => Promise<TResult> | TResult;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

export interface RunStoredMutationAdapterWithConflictResultOptions<
  TAttempt,
  TSaveAttempt extends TAttempt,
  TResult,
> extends Omit<
    RunStoredMutationAdapterOptions<TAttempt, TSaveAttempt, TResult>,
    "onConflict" | "onExhausted"
  > {
  onConflictOrExhausted: (
    current: CoordinatorPipelineSnapshot | undefined,
    attempt: TAttempt | undefined
  ) => Promise<TResult> | TResult;
}

export interface RunStoredMutationAdapterWithResponseOptions<
  TAttempt,
  TSaveAttempt extends TAttempt,
  TResult,
> extends Omit<
    RunStoredMutationAdapterWithConflictResultOptions<
      TAttempt,
      TSaveAttempt,
      TResult
    >,
    "attempts"
  > {
  maxAttempts?: number;
}

export function positiveMutationAttempts(value: number | undefined): number {
  const attempts = value ?? 2;

  assertPositiveInteger(attempts, "maxAttempts");
  return attempts;
}

export async function runStoredCoordinatorMutation<
  TAttempt,
  TSaveAttempt extends TAttempt,
  TResult,
>(
  options: RunStoredMutationOptions<TAttempt, TSaveAttempt, TResult>
): Promise<TResult> {
  const snapshot = await loadStoredMutationSnapshot({
    sessionId: options.sessionId,
    store: options.store,
  });

  if (snapshot === undefined) {
    return options.onMissing();
  }

  let currentSnapshot = snapshot;

  for (
    let attemptCount = 0;
    attemptCount < options.attempts;
    attemptCount += 1
  ) {
    const attemptResult = await options.mutate(currentSnapshot.state);
    const progress = await runStoredCoordinatorMutationAttempt({
      attempt: attemptResult,
      options,
      snapshot: currentSnapshot,
    });

    if (progress.status === "complete") {
      return progress.result;
    }

    currentSnapshot = progress.snapshot;
  }

  return options.onExhausted(currentSnapshot);
}

async function loadStoredMutationSnapshot(options: {
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}): Promise<CoordinatorPipelineSnapshot | undefined> {
  const snapshot = await options.store.load(options.sessionId);

  return snapshot === undefined
    ? undefined
    : parseCoordinatorPipelineSnapshot(snapshot);
}

async function runStoredCoordinatorMutationAttempt<
  TAttempt,
  TSaveAttempt extends TAttempt,
  TResult,
>({
  attempt,
  options,
  snapshot,
}: {
  attempt: TAttempt;
  options: RunStoredMutationOptions<TAttempt, TSaveAttempt, TResult>;
  snapshot: CoordinatorPipelineSnapshot;
}): Promise<StoredMutationAttemptProgress<TResult>> {
  const decision = options.decide(attempt, snapshot);

  if (decision.status === "terminal") {
    return {
      result: await decision.result,
      status: "complete",
    };
  }

  const saved = await options.store.save({
    expectedEtag: snapshot.etag,
    sessionId: options.sessionId,
    state: decision.state,
  });

  return await resolveSaveOutcome(saved, {
    attempt,
    options,
    saveAttempt: decision.attempt,
    snapshot,
  });
}

/**
 * A save either completes the mutation, loses the etag race with no winning
 * snapshot to report, or hands back the winner so the caller can retry on it.
 */
async function resolveSaveOutcome<
  TAttempt,
  TSaveAttempt extends TAttempt,
  TResult,
>(
  saved: Awaited<ReturnType<CoordinatorPipelineStore["save"]>>,
  context: {
    attempt: TAttempt;
    options: RunStoredMutationOptions<TAttempt, TSaveAttempt, TResult>;
    saveAttempt: TSaveAttempt;
    snapshot: CoordinatorPipelineSnapshot;
  }
): Promise<StoredMutationAttemptProgress<TResult>> {
  const { attempt, options, saveAttempt, snapshot } = context;

  if (isSavedCoordinatorPipelineMutationResult(saved)) {
    return {
      result: await options.onSaved(saved, saveAttempt, snapshot),
      status: "complete",
    };
  }

  if (saved.current === undefined) {
    return {
      result: await options.onConflict(undefined, attempt),
      status: "complete",
    };
  }

  return {
    snapshot: parseCoordinatorPipelineSnapshot(saved.current),
    status: "retry",
  };
}

export function runStoredCoordinatorMutationWithAdapters<
  TAttempt,
  TSaveAttempt extends TAttempt,
  TResult,
>(
  options: RunStoredMutationAdapterOptions<TAttempt, TSaveAttempt, TResult>
): Promise<TResult> {
  return runStoredCoordinatorMutation<TAttempt, TSaveAttempt, TResult>({
    attempts: options.attempts,
    decide: options.decide,
    mutate: options.mutate,
    onConflict: options.onConflict,
    onExhausted: options.onExhausted,
    onMissing: options.onMissing,
    onSaved: options.mapSaved,
    sessionId: options.sessionId,
    store: options.store,
  });
}

export function runStoredCoordinatorMutationWithAdaptersAndResponse<
  TAttempt,
  TSaveAttempt extends TAttempt,
  TResult,
>(
  options: RunStoredMutationAdapterWithResponseOptions<
    TAttempt,
    TSaveAttempt,
    TResult
  >
): Promise<TResult> {
  return runStoredCoordinatorMutationWithAdapters<
    TAttempt,
    TSaveAttempt,
    TResult
  >({
    attempts: positiveMutationAttempts(options.maxAttempts),
    decide: options.decide,
    mapSaved: options.mapSaved,
    mutate: options.mutate,
    onConflict: (current, attempt) =>
      options.onConflictOrExhausted(current, attempt),
    onExhausted: (snapshot) =>
      options.onConflictOrExhausted(snapshot, undefined),
    onMissing: options.onMissing,
    sessionId: options.sessionId,
    store: options.store,
  });
}

function isSavedCoordinatorPipelineMutationResult(
  result: CoordinatorPipelineMutationResult
): result is SavedCoordinatorPipelineResult {
  return result.status === "saved";
}
