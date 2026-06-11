import {
  type CoordinatorPipelineStore,
  type CoordinatorRetentionPlan,
  planCoordinatorRetention,
} from "../protocol";
import type { OlosId } from "../types/ids";

export interface PlanStoredCoordinatorRetentionOptions {
  now: string;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
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
