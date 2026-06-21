import type {
  CoordinatorPipelineMutation,
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineState,
  MutateCoordinatorPipelineOptions,
} from "./coordinator";
import {
  positiveMutationAttempts,
  runStoredCoordinatorMutationWithAdapters,
} from "./mutate-coordinator-store";

export async function mutateCoordinatorPipeline(
  options: MutateCoordinatorPipelineOptions
): Promise<CoordinatorPipelineMutation> {
  const attempts = positiveMutationAttempts(options.maxAttempts);

  const result = await runStoredCoordinatorMutationWithAdapters<
    { state: CoordinatorPipelineState },
    never,
    CoordinatorPipelineMutation
  >({
    attempts,
    mutate: async (state) => ({ state: await options.mutate(state) }),
    sessionId: options.sessionId,
    store: options.store,
    decide: (attempt) => ({ status: "save", state: attempt.state }),
    onMissing: () => missingCoordinatorPipelineMutation(),
    mapSaved: (saved) => saved,
    onConflict: (current) =>
      current === undefined
        ? { status: "conflict" }
        : conflictingCoordinatorPipelineMutation(current),
    onExhausted: (snapshot) => conflictingCoordinatorPipelineMutation(snapshot),
  });

  return result;
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
