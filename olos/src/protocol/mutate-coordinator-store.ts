import type { OlosId } from "../types/ids";
import type {
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineState,
  CoordinatorPipelineStore,
} from "./coordinator";

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
      result: TResult;
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

export async function runStoredCoordinatorMutation<TAttempt, TResult>(
  options: RunStoredMutationOptions<TAttempt, TResult>
): Promise<TResult> {
  let snapshot = await options.store.load(options.sessionId);

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
      return decision.result;
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

    snapshot = saved.current;
  }

  return options.onExhausted(snapshot);
}

function isSavedCoordinatorPipelineMutationResult(
  result: CoordinatorPipelineMutationResult
): result is SavedCoordinatorPipelineResult {
  return result.status === "saved";
}
