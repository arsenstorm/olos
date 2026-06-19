import { SESSION_STATES } from "../config/session";
import {
  type CoordinatorPipelineSnapshot,
  type CoordinatorPipelineState,
  type CoordinatorPipelineStore,
  type CoordinatorPublisherLease,
  createCoordinatorPipeline,
  mutateCoordinatorPipeline,
} from "../protocol";
import { assertSessionTransition } from "../state/session";
import type { OlosId } from "../types/ids";
import type { Pathway } from "../types/pathway";
import type { Session, SessionState } from "../types/session";
import { assertUrlSafeIdentifier } from "../validation/ids";
import {
  createRuntimePublisherLease,
  refreshRuntimePublisherHeartbeat,
} from "./publisher-lease";
import { jsonResponse } from "./response";

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

export interface HeartbeatStoredCoordinatorPublisherOptions {
  maxAttempts?: number;
  now: string;
  publisherInstanceId: OlosId;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
  ttlMs: number;
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

export type StoredRuntimePublisherHeartbeat =
  | {
      etag: string;
      lease: CoordinatorPublisherLease;
      response: Response;
      state: CoordinatorPipelineState;
      status: "refreshed";
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
    assertUrlSafeIdentifier(options.sessionId, "sessionId");
    assertSessionState(options.state);

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

export async function heartbeatStoredCoordinatorPublisher(
  options: HeartbeatStoredCoordinatorPublisherOptions
): Promise<StoredRuntimePublisherHeartbeat> {
  try {
    assertHeartbeatOptions(options);

    let lease: CoordinatorPublisherLease | undefined;
    const result = await mutateCoordinatorPipeline({
      maxAttempts: options.maxAttempts,
      mutate: (state) => {
        const next = heartbeatState(state, options);
        lease = next.lease;

        return next.state;
      },
      sessionId: options.sessionId,
      store: options.store,
    });

    if (result.status === "not_found") {
      return notFound();
    }

    if (result.status === "conflict") {
      return conflict(result.current);
    }

    if (lease === undefined) {
      throw new Error("publisher heartbeat did not create a lease");
    }

    return {
      etag: result.etag,
      lease,
      response: jsonResponse({ lease }, 200),
      state: result.state,
      status: "refreshed",
    };
  } catch (error) {
    return rejectedHeartbeat(error);
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

function heartbeatState(
  state: CoordinatorPipelineState,
  options: HeartbeatStoredCoordinatorPublisherOptions
): { lease: CoordinatorPublisherLease; state: CoordinatorPipelineState } {
  assertHeartbeatSessionState(state.session.state);

  const current = state.publisherLeases.find(
    (lease) => lease.publisherInstanceId === options.publisherInstanceId
  );
  const lease =
    current === undefined
      ? createRuntimePublisherLease({
          now: options.now,
          publisherInstanceId: options.publisherInstanceId,
          sessionId: options.sessionId,
          tenantId: state.session.tenantId,
          ttlMs: options.ttlMs,
        })
      : refreshRuntimePublisherHeartbeat({
          lease: current,
          now: options.now,
          publisherInstanceId: options.publisherInstanceId,
          sessionId: options.sessionId,
          tenantId: state.session.tenantId,
          ttlMs: options.ttlMs,
        });

  return {
    lease,
    state: {
      ...state,
      publisherLeases: [
        ...state.publisherLeases.filter(
          (entry) => entry.publisherInstanceId !== options.publisherInstanceId
        ),
        lease,
      ],
    },
  };
}

function assertHeartbeatSessionState(state: SessionState): void {
  if (state === "aborted" || state === "ended" || state === "expired") {
    throw new Error("publisher heartbeat is not allowed for terminal sessions");
  }
}

function assertHeartbeatOptions(
  options: HeartbeatStoredCoordinatorPublisherOptions
): void {
  assertUrlSafeIdentifier(options.sessionId, "sessionId");
  assertUrlSafeIdentifier(options.publisherInstanceId, "publisherInstanceId");
  timestampMs(options.now, "now");

  if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
    throw new Error("ttlMs must be a positive number");
  }
}

function assertSessionState(value: unknown): asserts value is SessionState {
  if (
    typeof value !== "string" ||
    !SESSION_STATES.includes(value as SessionState)
  ) {
    throw new Error(`state must be one of: ${SESSION_STATES.join(", ")}`);
  }
}

function timestampMs(value: string, name: string): number {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    throw new Error(`${name} must be a valid timestamp`);
  }

  return timestamp;
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

function rejectedHeartbeat(error: unknown): StoredRuntimePublisherHeartbeat {
  return {
    response: jsonResponse(
      {
        error: {
          message:
            error instanceof Error
              ? error.message
              : "publisher heartbeat was rejected",
        },
      },
      409
    ),
    status: "rejected",
  };
}
