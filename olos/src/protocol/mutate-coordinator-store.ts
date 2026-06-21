import type { OlosId } from "../types/ids";
import { assertPositiveInteger } from "../validation/ids";
import type {
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineState,
  CoordinatorPipelineStore,
} from "./coordinator";
import { parseCoordinatorPipelineSnapshot } from "./coordinator-snapshot";

type CoordinatorPipelineMutationResult = Awaited<
  ReturnType<CoordinatorPipelineStore["save"]>
>;

type SavedCoordinatorPipelineResult = Extract<
  CoordinatorPipelineMutationResult,
  { status: "saved" }
>;

type StoredMutationDecision<TResult> =
  | {
      status: "save";
      state: CoordinatorPipelineState;
    }
  | {
      status: "terminal";
      result: Promise<TResult> | TResult;
    };

export type MutationDecisionFunction<TAttempt, TResult> = (
  attempt: TAttempt,
  snapshot: CoordinatorPipelineSnapshot
) => StoredMutationDecision<TResult>;

export interface RunStoredMutationOptions<TAttempt, TResult> {
  attempts: number;
  decide(
    attempt: TAttempt,
    snapshot: CoordinatorPipelineSnapshot
  ): StoredMutationDecision<TResult>;
  mutate(state: CoordinatorPipelineState): TAttempt | Promise<TAttempt>;
  onConflict(
    current: CoordinatorPipelineSnapshot | undefined,
    attempt: TAttempt
  ): Promise<TResult> | TResult;
  onExhausted(
    snapshot: CoordinatorPipelineSnapshot
  ): Promise<TResult> | TResult;
  onMissing(): Promise<TResult> | TResult;
  onSaved(
    saved: SavedCoordinatorPipelineResult,
    attempt: TAttempt,
    snapshot: CoordinatorPipelineSnapshot
  ): Promise<TResult> | TResult;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

export interface RunStoredMutationAdapterOptions<
  TAttempt,
  TDecisionResult,
  TResult,
> {
  attempts: number;
  decide(
    attempt: TAttempt,
    snapshot: CoordinatorPipelineSnapshot
  ): StoredMutationDecision<TDecisionResult>;
  mapSaved(
    saved: SavedCoordinatorPipelineResult,
    attempt: TAttempt,
    snapshot: CoordinatorPipelineSnapshot
  ): Promise<TResult> | TResult;
  mapTerminal?: (
    result: TDecisionResult,
    attempt: TAttempt,
    snapshot: CoordinatorPipelineSnapshot
  ) => Promise<TResult> | TResult;
  mutate(state: CoordinatorPipelineState): TAttempt | Promise<TAttempt>;
  onConflict(
    current: CoordinatorPipelineSnapshot | undefined,
    attempt: TAttempt
  ): Promise<TResult> | TResult;
  onExhausted(
    snapshot: CoordinatorPipelineSnapshot
  ): Promise<TResult> | TResult;
  onMissing(): Promise<TResult> | TResult;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

export interface RunStoredMutationAdapterWithConflictResultOptions<
  TAttempt,
  TDecisionResult,
  TResult,
> extends Omit<
    RunStoredMutationAdapterOptions<TAttempt, TDecisionResult, TResult>,
    "onConflict" | "onExhausted"
  > {
  onConflictOrExhausted(
    current: CoordinatorPipelineSnapshot | undefined,
    attempt: TAttempt | undefined
  ): Promise<TResult> | TResult;
}

export interface RunStoredMutationAdapterWithResponseOptions<
  TAttempt,
  TDecisionResult,
  TResult,
> extends Omit<
    RunStoredMutationAdapterWithConflictResultOptions<
      TAttempt,
      TDecisionResult,
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

export async function runStoredCoordinatorMutation<TAttempt, TResult>(
  options: RunStoredMutationOptions<TAttempt, TResult>
): Promise<TResult> {
  let snapshot = await options.store.load(options.sessionId);

  if (snapshot !== undefined) {
    snapshot = parseCoordinatorPipelineSnapshot(snapshot);
  }

  if (snapshot === undefined) {
    return options.onMissing();
  }

  for (
    let attemptCount = 0;
    attemptCount < options.attempts;
    attemptCount += 1
  ) {
    const attemptResult = await options.mutate(snapshot.state);
    const decision = options.decide(attemptResult, snapshot);

    if (decision.status === "terminal") {
      return await decision.result;
    }

    const saved = await options.store.save({
      expectedEtag: snapshot.etag,
      sessionId: options.sessionId,
      state: decision.state,
    });

    if (isSavedCoordinatorPipelineMutationResult(saved)) {
      return options.onSaved(saved, attemptResult, snapshot);
    }

    if (saved.current === undefined) {
      return options.onConflict(undefined, attemptResult);
    }

    snapshot = parseCoordinatorPipelineSnapshot(saved.current);
  }

  return options.onExhausted(snapshot);
}

export async function runStoredCoordinatorMutationWithAdapters<
  TAttempt,
  TDecisionResult,
  TResult,
>(
  options: RunStoredMutationAdapterOptions<TAttempt, TDecisionResult, TResult>
): Promise<TResult> {
  const result = await runStoredCoordinatorMutation<TAttempt, TResult>({
    attempts: options.attempts,
    decide: (attempt, snapshot) => {
      const decision = options.decide(attempt, snapshot);

      if (decision.status === "terminal") {
        if (options.mapTerminal === undefined) {
          throw new Error("mutation terminal result is not supported");
        }

        return {
          status: "terminal",
          result: Promise.resolve(decision.result).then((result) =>
            options.mapTerminal?.(result, attempt, snapshot)
          ) as Promise<TResult>,
        };
      }

      return {
        status: "save",
        state: decision.state,
      };
    },
    mutate: options.mutate,
    onConflict: options.onConflict,
    onExhausted: options.onExhausted,
    onMissing: options.onMissing,
    onSaved: options.mapSaved,
    sessionId: options.sessionId,
    store: options.store,
  });

  return result;
}

export function runStoredCoordinatorMutationWithAdaptersAndConflict<
  TAttempt,
  TDecisionResult,
  TResult,
>(
  options: RunStoredMutationAdapterWithConflictResultOptions<
    TAttempt,
    TDecisionResult,
    TResult
  >
): Promise<TResult> {
  return runStoredCoordinatorMutationWithAdapters<
    TAttempt,
    TDecisionResult,
    TResult
  >({
    attempts: options.attempts,
    decide: options.decide,
    mapSaved: options.mapSaved,
    mapTerminal: options.mapTerminal,
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

export function runStoredCoordinatorMutationWithAdaptersAndResponse<
  TAttempt,
  TDecisionResult,
  TResult,
>(
  options: RunStoredMutationAdapterWithResponseOptions<
    TAttempt,
    TDecisionResult,
    TResult
  >
): Promise<TResult> {
  return runStoredCoordinatorMutationWithAdaptersAndConflict<
    TAttempt,
    TDecisionResult,
    TResult
  >({
    attempts: positiveMutationAttempts(options.maxAttempts),
    decide: options.decide,
    mapSaved: options.mapSaved,
    mapTerminal: options.mapTerminal,
    mutate: options.mutate,
    onConflictOrExhausted: options.onConflictOrExhausted,
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
