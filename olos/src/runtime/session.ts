import { SESSION_STATES } from "../config/session";
import {
  type CoordinatorPipelineMutation,
  type CoordinatorPipelineSnapshot,
  type CoordinatorPipelineState,
  type CoordinatorPipelineStore,
  type CoordinatorPublisherLease,
  type CoordinatorStoreSave,
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
import { positiveNumber, timestampMs } from "./request-fields";
import { jsonErrorResponse, jsonResponse } from "./response";
import { isStringLiteral } from "./string-literals";

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

type StoredSessionConflictSource = Extract<
  CoordinatorPipelineMutation | CoordinatorStoreSave,
  { status: "conflict" }
>;

type HandledStoredSessionMutation = Extract<
  CoordinatorPipelineMutation,
  { status: "conflict" | "not_found" }
>;

const HEARTBEAT_TERMINAL_SESSION_STATES = [
  "aborted",
  "ended",
  "expired",
] as const satisfies readonly SessionState[];

type HeartbeatTerminalSessionState =
  (typeof HEARTBEAT_TERMINAL_SESSION_STATES)[number];

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

  if (isStoredSessionConflictSource(saved)) {
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
    assertTransitionOptions(options);

    const result = await mutateCoordinatorPipeline({
      maxAttempts: options.maxAttempts,
      mutate: (state) => transitionState(state, options.state),
      sessionId: options.sessionId,
      store: options.store,
    });

    if (isHandledStoredSessionMutation(result)) {
      return handledStoredSessionMutation(result);
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

    if (isHandledStoredSessionMutation(result)) {
      return handledStoredSessionMutation(result);
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

function assertTransitionOptions(
  options: TransitionStoredCoordinatorSessionOptions
): void {
  assertUrlSafeIdentifier(options.sessionId, "sessionId");
  assertSessionState(options.state);
}

function assertHeartbeatOptions(
  options: HeartbeatStoredCoordinatorPublisherOptions
): void {
  assertUrlSafeIdentifier(options.sessionId, "sessionId");
  assertUrlSafeIdentifier(options.publisherInstanceId, "publisherInstanceId");
  timestampMs(options.now, "now");
  positiveNumber(options.ttlMs, "ttlMs");
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

  const lease = heartbeatLease(state, options);

  return {
    lease,
    state: {
      ...state,
      publisherLeases: replacePublisherLease(
        state.publisherLeases,
        options.publisherInstanceId,
        lease
      ),
    },
  };
}

function heartbeatLease(
  state: CoordinatorPipelineState,
  options: HeartbeatStoredCoordinatorPublisherOptions
): CoordinatorPublisherLease {
  const current = currentPublisherLease(
    state.publisherLeases,
    options.publisherInstanceId
  );

  if (current === undefined) {
    return createRuntimePublisherLease({
      now: options.now,
      publisherInstanceId: options.publisherInstanceId,
      sessionId: options.sessionId,
      tenantId: state.session.tenantId,
      ttlMs: options.ttlMs,
    });
  }

  return refreshRuntimePublisherHeartbeat({
    lease: current,
    now: options.now,
    publisherInstanceId: options.publisherInstanceId,
    sessionId: options.sessionId,
    tenantId: state.session.tenantId,
    ttlMs: options.ttlMs,
  });
}

function currentPublisherLease(
  leases: readonly CoordinatorPublisherLease[],
  publisherInstanceId: OlosId
): CoordinatorPublisherLease | undefined {
  return leases.find(
    (lease) => lease.publisherInstanceId === publisherInstanceId
  );
}

function replacePublisherLease(
  leases: readonly CoordinatorPublisherLease[],
  publisherInstanceId: OlosId,
  lease: CoordinatorPublisherLease
): CoordinatorPublisherLease[] {
  return [
    ...leases.filter(
      (entry) => entry.publisherInstanceId !== publisherInstanceId
    ),
    lease,
  ];
}

function assertHeartbeatSessionState(state: SessionState): void {
  if (isHeartbeatTerminalSessionState(state)) {
    throw new Error("publisher heartbeat is not allowed for terminal sessions");
  }
}

function isHeartbeatTerminalSessionState(
  state: SessionState
): state is HeartbeatTerminalSessionState {
  return isStringLiteral(state, HEARTBEAT_TERMINAL_SESSION_STATES);
}

function assertSessionState(value: unknown): asserts value is SessionState {
  if (typeof value !== "string" || !isStringLiteral(value, SESSION_STATES)) {
    throw new Error(`state must be one of: ${SESSION_STATES.join(", ")}`);
  }
}

function isStoredSessionConflictSource(
  result: CoordinatorPipelineMutation | CoordinatorStoreSave
): result is StoredSessionConflictSource {
  return result.status === "conflict";
}

function isHandledStoredSessionMutation(
  result: CoordinatorPipelineMutation
): result is HandledStoredSessionMutation {
  return result.status === "not_found" || isStoredSessionConflictSource(result);
}

function handledStoredSessionMutation(
  result: HandledStoredSessionMutation
): StoredRuntimeSessionMutation {
  return result.status === "not_found" ? notFound() : conflict(result.current);
}

function notFound(): StoredRuntimeSessionMutation {
  return {
    response: jsonErrorResponse("coordinator session was not found", 404),
    status: "not_found",
  };
}

function conflict(
  current: CoordinatorPipelineSnapshot | undefined
): StoredRuntimeSessionMutation {
  return {
    ...(current === undefined ? {} : { current }),
    response: jsonErrorResponse(
      "coordinator session changed during mutation",
      409
    ),
    status: "conflict",
  };
}

function rejected(error: unknown): StoredRuntimeSessionTransition {
  return {
    response: rejectionResponse(
      error,
      "coordinator session transition was rejected"
    ),
    status: "rejected",
  };
}

function rejectedHeartbeat(error: unknown): StoredRuntimePublisherHeartbeat {
  return {
    response: rejectionResponse(error, "publisher heartbeat was rejected"),
    status: "rejected",
  };
}

function rejectionResponse(error: unknown, fallbackMessage: string): Response {
  return jsonResponse(
    {
      error: {
        message: error instanceof Error ? error.message : fallbackMessage,
      },
    },
    409
  );
}
