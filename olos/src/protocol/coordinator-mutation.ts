import type {
  CoordinatorPipelineMutation,
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineState,
  MutateCoordinatorPipelineOptions,
} from "./coordinator-types";
import {
  positiveMutationAttempts,
  runStoredCoordinatorMutationWithAdapters,
} from "./mutate-coordinator-store";

/**
 * Run an optimistic read-modify-write cycle against a coordinator store:
 * load the session's snapshot, apply `mutate` to its state, and save with
 * the loaded etag as `expectedEtag`.
 *
 * When the save conflicts because another writer won, the cycle retries
 * against the winning snapshot — `mutate` runs again on the fresh state —
 * up to `maxAttempts` total attempts (default 2). Returns `"not_found"`
 * when no snapshot exists for the session, and `"conflict"` when attempts
 * are exhausted or the store reports a conflict without a current snapshot
 * (e.g. the record was deleted mid-flight).
 */
export async function mutateCoordinatorPipeline(
  options: MutateCoordinatorPipelineOptions
): Promise<CoordinatorPipelineMutation> {
  const attempts = positiveMutationAttempts(options.maxAttempts);

  return await runStoredCoordinatorMutationWithAdapters<
    { state: CoordinatorPipelineState },
    { state: CoordinatorPipelineState },
    CoordinatorPipelineMutation
  >({
    attempts,
    decide: (attempt) => ({ attempt, state: attempt.state, status: "save" }),
    mapSaved: (saved) => saved,
    mutate: async (state) => ({ state: await options.mutate(state) }),
    onConflict: (current) =>
      current === undefined
        ? { status: "conflict" }
        : conflictingCoordinatorPipelineMutation(current),
    onExhausted: (snapshot) => conflictingCoordinatorPipelineMutation(snapshot),
    onMissing: () => missingCoordinatorPipelineMutation(),
    sessionId: options.sessionId,
    store: options.store,
  });
}

function missingCoordinatorPipelineMutation(): Extract<
  CoordinatorPipelineMutation,
  { status: "not_found" }
> {
  return { status: "not_found" };
}

function conflictingCoordinatorPipelineMutation(
  current: CoordinatorPipelineSnapshot
): Extract<CoordinatorPipelineMutation, { status: "conflict" }> {
  return {
    current,
    status: "conflict",
  };
}
