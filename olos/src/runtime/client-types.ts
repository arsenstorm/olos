import type { CoordinatorRetentionPlan } from "../protocol/coordinator-types";
import type { Commit } from "../types/commit";
import type { Cursor } from "../types/cursor";
import type { Session, SessionState } from "../types/session";
import type { UploadSlot } from "../types/upload-slot";
import type { RuntimeCommitPayload } from "./commit";
import type { RuntimeLiveHealth } from "./health";
import type { RuntimeHttpFetch } from "./http-client";
import type { RuntimePublisherLease } from "./publisher-lease";
import type { RuntimeSlotIssuePayload } from "./slot";
export const HEALTH_CURSOR_FRESHNESS_VALUES = [
  "fresh",
  "stale",
  "missing",
] as const;
export const HEALTH_STATUS_VALUES = ["active", "stale", "starting"] as const;
export const HEALTH_LEASE_STATUS_VALUES = ["active", "stale"] as const;

/**
 * Fetch-compatible function the runtime HTTP client uses to send requests.
 * Defaults to the global `fetch`; override it to add authentication,
 * retries, or to route requests in tests.
 */
export type RuntimeFetch = RuntimeHttpFetch;

/** Connection options shared by every runtime HTTP client call. */
export interface RuntimeHttpClientOptions {
  /**
   * Coordinator base URL. A trailing slash is added when missing so route
   * paths resolve underneath it.
   */
  baseUrl: string;
  /** Transport override; defaults to the global `fetch`. */
  fetch?: RuntimeFetch;
}

/**
 * Error thrown by the runtime HTTP client when the coordinator returns a
 * non-2xx response. Client calls never return structured error results; any
 * failed response surfaces as this throw. The response body is read from a
 * clone and exposed as `body`: parsed JSON when possible — for coordinator
 * errors an envelope whose `error.code` is an `olos.*` code — otherwise the
 * raw text, or `undefined` when the body is empty.
 */
export class RuntimeHttpError extends Error {
  /**
   * Response body: parsed JSON when possible, otherwise the raw text;
   * `undefined` when the body is empty.
   */
  readonly body: unknown;
  readonly response: Response;
  /** HTTP status code, mirrored from `response.status`. */
  readonly status: number;

  constructor(message: string, response: Response, body: unknown) {
    super(message);
    this.body = body;
    this.name = "RuntimeHttpError";
    this.response = response;
    this.status = response.status;
  }
}

/** Options for `sendRuntimePublisherHeartbeat`. */
export interface RuntimePublisherHeartbeatOptions
  extends RuntimeHttpClientOptions {
  publisherInstanceId: string;
  sessionId: string;
}

/** Options for `createRuntimeSession`. */
export interface RuntimeCreateSessionOptions extends RuntimeHttpClientOptions {
  /** Public base URL that delivery URLs for the session's media resolve to. */
  deliveryBaseUrl: string;
  session: Session;
}

/** Options for `transitionRuntimeSession`. */
export interface RuntimeTransitionSessionOptions
  extends RuntimeHttpClientOptions {
  sessionId: string;
  /** Target session state to transition to. */
  state: SessionState;
}

/** Options for `issueRuntimeSlot`. */
export interface RuntimeIssueSlotOptions extends RuntimeHttpClientOptions {
  payload: RuntimeSlotIssuePayload;
  sessionId: string;
}

/** Options for `commitRuntimeUpload`. */
export interface RuntimeCommitUploadOptions extends RuntimeHttpClientOptions {
  payload: RuntimeCommitPayload;
  sessionId: string;
}

/** Options for `getRuntimeSessionHealth`. */
export interface RuntimeSessionHealthOptions extends RuntimeHttpClientOptions {
  /**
   * Scope the health check to one publisher's lease instead of the most
   * recently seen lease.
   */
  publisherInstanceId?: string;
  sessionId: string;
}

/** Options for `getRuntimeSessionRetentionPlan`. */
export interface RuntimeSessionRetentionOptions
  extends RuntimeHttpClientOptions {
  /**
   * Timestamp the retention plan is evaluated at, as an ISO 8601 string.
   * Defaults to the coordinator's current time.
   */
  now?: string;
  sessionId: string;
}

/** Options for `getRuntimeMasterPlaylist`. */
export interface RuntimeMasterPlaylistOptions extends RuntimeHttpClientOptions {
  /** Live route prefix relative to `baseUrl`; defaults to `v1/live`. */
  livePath?: string;
  sessionId: string;
}

/** Options for `getRuntimeMediaPlaylist`. */
export interface RuntimeMediaPlaylistOptions
  extends RuntimeMasterPlaylistOptions {
  /** `_HLS_msn` blocking-reload parameter (media sequence number). */
  hlsMsn?: number;
  /** `_HLS_part` blocking-reload parameter (part number). */
  hlsPart?: number;
  trackId: string;
}

/** Result of `sendRuntimePublisherHeartbeat`: the refreshed lease. */
export interface RuntimePublisherHeartbeatResponse {
  lease: RuntimePublisherLease;
  response: Response;
}

/** Result of `createRuntimeSession`: the created session's id. */
export interface RuntimeCreateSessionResponse {
  response: Response;
  sessionId: string;
}

/** Result of `transitionRuntimeSession`: the session's new state. */
export interface RuntimeTransitionSessionResponse {
  response: Response;
  sessionId: string;
  state: SessionState;
}

/** Result of `issueRuntimeSlot`: the issued upload slot. */
export interface RuntimeIssueSlotResponse {
  response: Response;
  slot: UploadSlot;
}

/** Result of `commitRuntimeUpload`. */
export interface RuntimeCommitUploadResponse {
  commit: Commit;
  /**
   * Session cursor after the commit; absent when the coordinator response
   * did not include one (for example an idempotent replay).
   */
  cursor?: Cursor;
  response: Response;
}

/** Result of `getRuntimeSessionHealth`: the resolved live health. */
export interface RuntimeSessionHealthResponse {
  health: RuntimeLiveHealth;
  response: Response;
}

/** Result of `getRuntimeSessionRetentionPlan`. */
export interface RuntimeSessionRetentionResponse {
  plan: CoordinatorRetentionPlan;
  response: Response;
}

/** Result of a playlist fetch: the raw M3U8 text. */
export interface RuntimePlaylistResponse {
  playlist: string;
  response: Response;
}
