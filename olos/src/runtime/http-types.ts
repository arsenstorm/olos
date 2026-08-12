import type { HlsCursorWaitContext } from "../hls/blocking-reload";
import type { CreateHlsManifestArtifactResponseOptions } from "../hls/manifest-artifacts";
import type {
  CoordinatorCommitPolicy,
  CoordinatorPipelineStore,
} from "../protocol/coordinator-types";
import type { PublicationControlPolicy } from "../state/publication-control";
import type { PublicationMode } from "../types/upload-slot";
import type { RuntimeCursorNotifier } from "./cursor-notifier";
import { DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE } from "./latency-profile-defaults";
import { SESSION_ROUTE_ACTIONS } from "./route";
export const DEFAULT_RUNTIME_OBJECT_LOW_LATENCY =
  DEFAULT_RUNTIME_OBJECT_LOW_LATENCY_PROFILE;
export const DEFAULT_MAX_HEALTH_CURSOR_AGE_MS =
  DEFAULT_RUNTIME_OBJECT_LOW_LATENCY.cursorMaxAgeMs;
export const DEFAULT_PUBLISHER_LEASE_TTL_MS =
  DEFAULT_RUNTIME_OBJECT_LOW_LATENCY.publisherLeaseTtlMs;
export const DEFAULT_TARGET_LATENCY =
  DEFAULT_RUNTIME_OBJECT_LOW_LATENCY.targetLatency;
export const defaultRuntimeNow = () => new Date().toISOString();

export const GET_ONLY_SESSION_ROUTE_ACTIONS = [
  SESSION_ROUTE_ACTIONS.health,
  SESSION_ROUTE_ACTIONS.retention,
] as const;
export const POST_ONLY_SESSION_ROUTE_ACTIONS = [
  SESSION_ROUTE_ACTIONS.commits,
  SESSION_ROUTE_ACTIONS.heartbeat,
  SESSION_ROUTE_ACTIONS.slots,
  SESSION_ROUTE_ACTIONS.transition,
] as const;

export interface InvalidRuntimeHttpRequestParse {
  message: string;
  status: "invalid" | "too_large";
}

export type RuntimeHttpRequestParse<Valid extends object> =
  | (Valid & { status: "valid" })
  | InvalidRuntimeHttpRequestParse;

export type RuntimeLiveManifestRoute =
  | {
      kind: "master";
      sessionId: string;
    }
  | {
      kind: "media";
      sessionId: string;
    };

/** Options for `createStoredCoordinatorRuntimeHandler`. */
export interface CreateStoredCoordinatorRuntimeHandlerOptions {
  /** HTTPS origins media delivery URLs may point at. Origins only — no paths. */
  allowedMediaOrigins: readonly string[];
  /**
   * Enable low-latency blocking playlist reloads (`_HLS_msn`/`_HLS_part`).
   * `timeoutMs` bounds how long a reload is held open, in milliseconds;
   * `waitForCursor` resolves once the session's cursor advances (typically a
   * `RuntimeCursorNotifier`'s `waitForCursor`). Omit to serve media
   * playlists non-blocking.
   */
  blockingReload?: {
    timeoutMs: number;
    waitForCursor: (
      context: HlsCursorWaitContext
    ) => Promise<HlsCursorWaitContext["cursor"] | undefined>;
  };
  /** Alias for `now`, consulted only when `now` is not set. */
  clock?: () => string;
  commitPolicy?: CoordinatorCommitPolicy;
  /**
   * Notified with the new cursor after every successful commit and session
   * transition.
   */
  cursorNotifier?: RuntimeCursorNotifier;
  /** Default commit late tolerance, in milliseconds. */
  lateToleranceMs?: number;
  /** Route prefix for playlist requests; defaults to `/v1/live`. */
  livePath?: string;
  /** Max optimistic-save attempts per mutation; defaults to 2. */
  maxAttempts?: number;
  /**
   * Largest accepted JSON request body, in bytes; defaults to 1 MiB.
   * Oversized bodies are rejected with 413 before parsing.
   */
  maxBodyBytes?: number;
  /** Cursor age at which health reports stale, in ms; defaults to 5000. */
  maxHealthCursorAgeMs?: number;
  /**
   * Returns the current time as an ISO 8601 timestamp; defaults to the
   * system clock. Takes precedence over `clock`.
   */
  now?: () => string;
  publicationControl?: PublicationControlPolicy;
  /** Publication mode for created sessions; defaults to `direct-public`. */
  publicationMode?: PublicationMode;
  /** Publisher lease TTL granted on heartbeat, in ms; defaults to 3000. */
  publisherLeaseTtlMs?: number;
  /** Cache policy overrides for playlist responses. */
  response?: CreateHlsManifestArtifactResponseOptions;
  /** Route prefix for session requests; defaults to `/sessions`. */
  sessionPath?: string;
  store: CoordinatorPipelineStore;
  /** HLS target latency written into playlists, in seconds; defaults to 3. */
  targetLatency?: number;
}

/** Request handler returned by `createStoredCoordinatorRuntimeHandler`. */
export type StoredCoordinatorRuntimeHandler = (
  request: Request
) => Promise<Response>;
