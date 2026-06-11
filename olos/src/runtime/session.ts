import {
  type CoordinatorPipelineSnapshot,
  type CoordinatorPipelineState,
  type CoordinatorPipelineStore,
  createCoordinatorPipeline,
  mutateCoordinatorPipeline,
} from "../protocol";
import { assertSessionTransition } from "../state/session";
import type { OlosId } from "../types/ids";
import type { Pathway } from "../types/pathway";
import type { Session, SessionState } from "../types/session";

export interface CreateStoredCoordinatorSessionOptions {
  pathways: readonly Pathway[];
  session: Session;
  store: CoordinatorPipelineStore;
}

export interface TransitionStoredCoordinatorSessionOptions {
  maxAttempts?: number;
  sessionId: OlosId;
  state: SessionState;
  store: CoordinatorPipelineStore;
}

export type StoredRuntimeSessionCreate =
  | {
      etag: string;
      response: Response;
      state: CoordinatorPipelineState;
      status: "created";
    }
  | StoredRuntimeSessionMutation;

export type StoredRuntimeSessionTransition =
  | {
      etag: string;
      response: Response;
      state: CoordinatorPipelineState;
      status: "transitioned";
    }
  | {
      response: Response;
      status: "rejected";
    }
  | StoredRuntimeSessionMutation;

export type StoredRuntimeSessionMutation =
  | {
      current?: CoordinatorPipelineSnapshot;
      response: Response;
      status: "conflict";
    }
  | {
      response: Response;
      status: "not_found";
    };

export async function createStoredCoordinatorSession(
  options: CreateStoredCoordinatorSessionOptions
): Promise<StoredRuntimeSessionCreate> {
  const current = await options.store.load(options.session.sessionId);

  if (current !== undefined) {
    return conflict(current);
  }

  const state = createCoordinatorPipeline({
    pathways: options.pathways,
    session: options.session,
  });
  const saved = await options.store.save({
    sessionId: options.session.sessionId,
    state,
  });

  if (saved.status === "conflict") {
    return conflict(saved.current);
  }

  return {
    etag: saved.etag,
    response: jsonResponse({ sessionId: options.session.sessionId }, 201),
    state: saved.state,
    status: "created",
  };
}

export async function transitionStoredCoordinatorSession(
  options: TransitionStoredCoordinatorSessionOptions
): Promise<StoredRuntimeSessionTransition> {
  try {
    const result = await mutateCoordinatorPipeline({
      maxAttempts: options.maxAttempts,
      mutate: (state) => transitionState(state, options.state),
      sessionId: options.sessionId,
      store: options.store,
    });

    if (result.status === "not_found") {
      return notFound();
    }

    if (result.status === "conflict") {
      return conflict(result.current);
    }

    return {
      etag: result.etag,
      response: jsonResponse(
        {
          sessionId: options.sessionId,
          state: result.state.session.state,
        },
        200
      ),
      state: result.state,
      status: "transitioned",
    };
  } catch (error) {
    return rejected(error);
  }
}

function transitionState(
  state: CoordinatorPipelineState,
  nextState: SessionState
): CoordinatorPipelineState {
  assertSessionTransition(state.session.state, nextState);

  return {
    ...state,
    ...(state.cursor === undefined
      ? {}
      : { cursor: { ...state.cursor, state: nextState } }),
    session: {
      ...state.session,
      state: nextState,
    },
  };
}

function notFound(): StoredRuntimeSessionMutation {
  return {
    response: jsonResponse(
      { error: { message: "coordinator session was not found" } },
      404
    ),
    status: "not_found",
  };
}

function conflict(
  current: CoordinatorPipelineSnapshot | undefined
): StoredRuntimeSessionMutation {
  return {
    ...(current === undefined ? {} : { current }),
    response: jsonResponse(
      { error: { message: "coordinator session changed during mutation" } },
      409
    ),
    status: "conflict",
  };
}

function rejected(error: unknown): StoredRuntimeSessionTransition {
  return {
    response: jsonResponse(
      {
        error: {
          message:
            error instanceof Error
              ? error.message
              : "coordinator session transition was rejected",
        },
      },
      409
    ),
    status: "rejected",
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  });
}
