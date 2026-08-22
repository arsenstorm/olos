import type {
  CoordinatorPipelineMutation,
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineState,
  CoordinatorPipelineStore,
  CoordinatorPublisherLease,
  CoordinatorStoreSave,
} from "../protocol/coordinator-types";
import type { OlosId } from "../types/ids";
import type { Session, SessionState } from "../types/session";
import type { PublicationMode } from "../types/upload-slot";
/** Options for `createStoredCoordinatorSession`. */
export interface CreateStoredCoordinatorSessionOptions {
  /** Public base URL that the session's object delivery URLs resolve to. */
  deliveryBaseUrl: string;
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

export type StoredSessionConflictSource = Extract<
  CoordinatorPipelineMutation | CoordinatorStoreSave,
  { status: "conflict" }
>;

export type HandledStoredSessionMutation = Extract<
  CoordinatorPipelineMutation,
  { status: "conflict" | "not_found" }
>;
