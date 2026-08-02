import { SESSION_STATES } from "../config/session";
import { createCoordinatorPipeline } from "../protocol/coordinator-lifecycle";
import { mutateCoordinatorPipeline } from "../protocol/coordinator-mutation";
import type {
  CoordinatorPipelineMutation,
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineState,
  CoordinatorPipelineStore,
  CoordinatorPublisherLease,
  CoordinatorStoreSave,
} from "../protocol/coordinator-types";
import { assertSessionTransition } from "../state/session";
import { createOlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { Session, SessionState } from "../types/session";
import type { PublicationMode } from "../types/upload-slot";
import { isAllowedString, positiveNumber } from "../validation/fields";
import { assertUrlSafeIdentifier } from "../validation/ids";
import {
  createRuntimePublisherLease,
  refreshRuntimePublisherHeartbeat,
} from "./publisher-lease";
import { timestampMs } from "./request-fields";
import {
  jsonConflictResponse,
  jsonErrorResponse,
  jsonResponse,
} from "./response";

/** Options for `createStoredCoordinatorSession`. */
export interface CreateStoredCoordinatorSessionOptions {
  /** Public base URL that delivery URLs for the session's media resolve to. */
  mediaBaseUrl: string;
  /** Defaults to `direct-public`. */
  publicationMode?: PublicationMode;
  session: Session;
  store: CoordinatorPipelineStore;
}

/** Options for `transitionStoredCoordinatorSession`. */
export interface TransitionStoredCoordinatorSessionOptions {
  /** Max optimistic-save attempts; defaults to 2. */
  maxAttempts?: number;
  sessionId: OlosId;
  /** Target session state to transition to. */
  state: SessionState;
  store: CoordinatorPipelineStore;
}

/** Options for `heartbeatStoredCoordinatorPublisher`. */
export interface HeartbeatStoredCoordinatorPublisherOptions {
  /** Max optimistic-save attempts; defaults to 2. */
  maxAttempts?: number;
  /** Heartbeat time as an ISO 8601 timestamp. */
  now: string;
  publisherInstanceId: OlosId;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
  /** Lease lifetime granted from `now`, in milliseconds. */
  ttlMs: number;
}

/**
 * Outcome of `createStoredCoordinatorSession`: `created` with the saved
 * state and its etag, or `conflict` when the session id already exists.
 * Every variant carries a ready-to-return JSON `response`.
 */
export type StoredRuntimeSessionCreate =
  | {
      etag: string;
      response: Response;
      state: CoordinatorPipelineState;
      status: "created";
    }
  | StoredRuntimeSessionMutation;

/**
 * Outcome of `transitionStoredCoordinatorSession`: `transitioned` with the
 * saved state and its etag, `rejected` (400 `olos.invalid_request` for
 * malformed options, 409 `olos.invalid_state` when the transition is
 * invalid from the current state), or a `StoredRuntimeSessionMutation`
 * failure.
 */
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

/**
 * Outcome of `heartbeatStoredCoordinatorPublisher`: `refreshed` with the
 * new lease, saved state, and etag; `rejected` (400 `olos.invalid_request`
 * for malformed options, 409 `olos.invalid_state` when the session is in a
 * terminal state); or a `StoredRuntimeSessionMutation` failure.
 */
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

/**
 * Failure outcomes shared by stored session mutations: `conflict` (409)
 * when concurrent writes exhausted the optimistic retries — with the latest
 * snapshot when available — or `not_found` (404) when the session does not
 * exist.
 */
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
] as const satisfies readonly SessionState[];

type HeartbeatTerminalSessionState =
  (typeof HEARTBEAT_TERMINAL_SESSION_STATES)[number];

/**
 * Create a coordinator session in the store and return a 201 response with
 * its id. Refuses to overwrite: an existing session with the same id — or
 * one that appears concurrently during the save — yields `conflict` (409).
 */
export async function createStoredCoordinatorSession(
  options: CreateStoredCoordinatorSessionOptions
): Promise<StoredRuntimeSessionCreate> {
  const current = await options.store.load(options.session.sessionId);

  if (current !== undefined) {
    return conflict(current);
  }

  const state = createCoordinatorPipeline({
    mediaBaseUrl: options.mediaBaseUrl,
    publicationMode: options.publicationMode,
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

/**
 * Move a stored session to a new lifecycle state with optimistic-retry
 * persistence (up to `maxAttempts`, default 2). The cursor's state field is
 * kept in step when a cursor exists. Malformed options yield `rejected`
 * with 400 `olos.invalid_request` before any store read; disallowed
 * transitions from the current state yield `rejected` with 409
 * `olos.invalid_state` rather than throwing.
 */
export async function transitionStoredCoordinatorSession(
  options: TransitionStoredCoordinatorSessionOptions
): Promise<StoredRuntimeSessionTransition> {
  // Request-shape validation runs before any store read and fails with 400
  // `olos.invalid_request`; only state-machine rejections below are 409.
  try {
    assertTransitionOptions(options);
  } catch (error) {
    return {
      response: invalidRequestResponse(
        error,
        "coordinator session transition options were invalid"
      ),
      status: "rejected",
    };
  }

  try {
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

/**
 * Record a publisher heartbeat on a stored session: creates the publisher's
 * lease on first sight, refreshes it (extending expiry by `ttlMs`
 * milliseconds from `now`) afterwards, and persists via optimistic-retry.
 * Malformed options yield `rejected` with 400 `olos.invalid_request`
 * before any store read; heartbeats against `ended` or `aborted` sessions
 * yield `rejected` with 409 `olos.invalid_state`.
 */
export async function heartbeatStoredCoordinatorPublisher(
  options: HeartbeatStoredCoordinatorPublisherOptions
): Promise<StoredRuntimePublisherHeartbeat> {
  // Same split as the transition path: malformed options are 400
  // `olos.invalid_request` before any store read.
  try {
    assertHeartbeatOptions(options);
  } catch (error) {
    return {
      response: invalidRequestResponse(
        error,
        "publisher heartbeat options were invalid"
      ),
      status: "rejected",
    };
  }

  try {
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
    ...transitionedCursorField(state, nextState),
    session: {
      ...state.session,
      state: nextState,
    },
  };
}

function transitionedCursorField(
  state: CoordinatorPipelineState,
  nextState: SessionState
): Pick<CoordinatorPipelineState, "cursor"> {
  return state.cursor === undefined
    ? {}
    : { cursor: { ...state.cursor, state: nextState } };
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
      ttlMs: options.ttlMs,
    });
  }

  return refreshRuntimePublisherHeartbeat({
    lease: current,
    now: options.now,
    publisherInstanceId: options.publisherInstanceId,
    sessionId: options.sessionId,
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
  return isAllowedString(state, HEARTBEAT_TERMINAL_SESSION_STATES);
}

function assertSessionState(value: unknown): asserts value is SessionState {
  if (typeof value !== "string" || !isAllowedString(value, SESSION_STATES)) {
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
    response: jsonErrorResponse(
      "olos.invalid_session",
      "coordinator session was not found",
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
    response: jsonConflictResponse(
      "coordinator session changed during mutation"
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
    createOlosError(
      "olos.invalid_state",
      error instanceof Error ? error.message : fallbackMessage
    ),
    409
  );
}

function invalidRequestResponse(
  error: unknown,
  fallbackMessage: string
): Response {
  return jsonResponse(
    createOlosError(
      "olos.invalid_request",
      error instanceof Error ? error.message : fallbackMessage
    ),
    400
  );
}
