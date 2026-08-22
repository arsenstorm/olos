import { SESSION_STATES } from "../config/session";
import type {
  CoordinatorPipelineMutation,
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineState,
  CoordinatorPublisherLease,
  CoordinatorStoreSave,
} from "../protocol/coordinator-types";
import { assertSessionTransition } from "../state/session";
import { createOlosError } from "../types/errors";
import type { OlosId } from "../types/ids";
import type { SessionState } from "../types/session";
import { isAllowedString, positiveNumber } from "../validation/fields";
import { assertUrlSafeIdentifier } from "../validation/ids";
import {
  createRuntimePublisherLease,
  RuntimePublisherLeaseClockError,
  refreshRuntimePublisherHeartbeat,
} from "./publisher-lease";
import { timestampMs } from "./request-fields";
import {
  jsonConflictResponse,
  jsonErrorResponse,
  jsonResponse,
} from "./response";
import {
  HEARTBEAT_TERMINAL_SESSION_STATES,
  type HeartbeatTerminalSessionState,
  StoredSessionRejectionError,
} from "./session";
import type {
  HandledStoredSessionMutation,
  HeartbeatStoredCoordinatorPublisherOptions,
  StoredRuntimePublisherHeartbeat,
  StoredRuntimeSessionMutation,
  StoredRuntimeSessionTransition,
  StoredSessionConflictSource,
  TransitionStoredCoordinatorSessionOptions,
} from "./session-types";

export function assertTransitionOptions(
  options: TransitionStoredCoordinatorSessionOptions
): void {
  assertUrlSafeIdentifier(options.sessionId, "sessionId");
  assertSessionState(options.state);
}

export function assertHeartbeatOptions(
  options: HeartbeatStoredCoordinatorPublisherOptions
): void {
  assertUrlSafeIdentifier(options.sessionId, "sessionId");
  assertUrlSafeIdentifier(options.publisherInstanceId, "publisherInstanceId");
  timestampMs(options.now, "now");
  positiveNumber(options.ttlMs, "ttlMs");
}

export function transitionState(
  state: CoordinatorPipelineState,
  nextState: SessionState
): CoordinatorPipelineState {
  try {
    assertSessionTransition(state.session.state, nextState);
  } catch (error) {
    throw storedSessionRejection(
      error,
      "coordinator session transition was rejected"
    );
  }

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

export function heartbeatState(
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

  try {
    return refreshRuntimePublisherHeartbeat({
      lease: current,
      now: options.now,
      publisherInstanceId: options.publisherInstanceId,
      sessionId: options.sessionId,
      ttlMs: options.ttlMs,
    });
  } catch (error) {
    throw leaseClockRejection(error);
  }
}

/**
 * A heartbeat clocked before its lease was issued is a state-machine
 * rejection (409 `olos.invalid_state`), not an internal failure.
 */
function leaseClockRejection(error: unknown): unknown {
  return error instanceof RuntimePublisherLeaseClockError
    ? new StoredSessionRejectionError(error.message)
    : error;
}

function storedSessionRejection(
  error: unknown,
  fallbackMessage: string
): StoredSessionRejectionError {
  return new StoredSessionRejectionError(
    error instanceof Error ? error.message : fallbackMessage
  );
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
    throw new StoredSessionRejectionError(
      "publisher heartbeat is not allowed for terminal sessions"
    );
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

export function isStoredSessionConflictSource(
  result: CoordinatorPipelineMutation | CoordinatorStoreSave
): result is StoredSessionConflictSource {
  return result.status === "conflict";
}

export function isHandledStoredSessionMutation(
  result: CoordinatorPipelineMutation
): result is HandledStoredSessionMutation {
  return result.status === "not_found" || isStoredSessionConflictSource(result);
}

export function handledStoredSessionMutation(
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

export function conflict(
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

export function rejected(error: unknown): StoredRuntimeSessionTransition {
  return {
    response: rejectionResponse(
      error,
      "coordinator session transition was rejected"
    ),
    status: "rejected",
  };
}

export function rejectedHeartbeat(
  error: unknown
): StoredRuntimePublisherHeartbeat {
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

export function invalidRequestResponse(
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
