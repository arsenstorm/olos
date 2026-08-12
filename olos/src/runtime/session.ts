import { createCoordinatorPipeline } from "../protocol/coordinator-lifecycle";
import { mutateCoordinatorPipeline } from "../protocol/coordinator-mutation";
import type { CoordinatorPublisherLease } from "../protocol/coordinator-types";
import type { SessionState } from "../types/session";
import { jsonResponse } from "./response";
import {
  assertHeartbeatOptions,
  assertTransitionOptions,
  conflict,
  handledStoredSessionMutation,
  heartbeatState,
  invalidRequestResponse,
  isHandledStoredSessionMutation,
  isStoredSessionConflictSource,
  rejected,
  rejectedHeartbeat,
  transitionState,
} from "./session-state";
import type {
  CreateStoredCoordinatorSessionOptions,
  HeartbeatStoredCoordinatorPublisherOptions,
  StoredRuntimePublisherHeartbeat,
  StoredRuntimeSessionCreate,
  StoredRuntimeSessionTransition,
  TransitionStoredCoordinatorSessionOptions,
} from "./session-types";
/**
 * Marks state-machine rejections raised inside a mutation callback. Only
 * these map to 409 `olos.invalid_state` with their message in the body;
 * any other throw (store I/O, snapshot corruption) propagates to the
 * handler's opaque 500 instead of leaking its message as a 409.
 */
export class StoredSessionRejectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoredSessionRejectionError";
  }
}

export const HEARTBEAT_TERMINAL_SESSION_STATES = [
  "aborted",
  "ended",
] as const satisfies readonly SessionState[];

export type HeartbeatTerminalSessionState =
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
    if (error instanceof StoredSessionRejectionError) {
      return rejected(error);
    }

    throw error;
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
    if (error instanceof StoredSessionRejectionError) {
      return rejectedHeartbeat(error);
    }

    throw error;
  }
}
