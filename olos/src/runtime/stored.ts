import type {
  CoordinatorCommitPolicy,
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineStore,
} from "../protocol/coordinator-types";
import { runStoredCoordinatorMutationWithAdaptersAndResponse } from "../protocol/mutate-coordinator-store";
import type { PublicationControlPolicy } from "../state/publication-control";
import type { Cursor } from "../types/cursor";
import type { OlosId } from "../types/ids";
import type { Session } from "../types/session";
import { isAllowedString } from "../validation/fields";
import {
  commitCoordinatorUploadFromRequest,
  type RuntimeCommitRequest,
  type RuntimeCoordinatorUploadCommit,
} from "./commit";
import {
  type ServeBlockingCoordinatorManifestOptions,
  type ServeCoordinatorManifestOptions,
  serveBlockingCoordinatorManifest,
  serveCoordinatorManifest,
} from "./manifest";
import { jsonConflictResponse, jsonErrorResponse } from "./response";
import {
  issueCoordinatorSlotFromRequest,
  type RuntimeCoordinatorSlotIssue,
  type RuntimeSlotIssueRequest,
} from "./slot";

/** Options for `issueStoredCoordinatorSlotFromRequest`. */
export interface IssueStoredCoordinatorSlotFromRequestOptions {
  /** Max optimistic-save attempts; defaults to 2. */
  maxAttempts?: number;
  publicationControl?: PublicationControlPolicy;
  request: RuntimeSlotIssueRequest;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

/** Options for `commitStoredCoordinatorUploadFromRequest`. */
export interface CommitStoredCoordinatorUploadFromRequestOptions {
  commitPolicy?: CoordinatorCommitPolicy;
  /**
   * How far behind the cursor a commit may land and still be accepted, in
   * milliseconds. A `lateToleranceMs` in the payload takes precedence.
   */
  lateToleranceMs?: number;
  /** Max optimistic-save attempts; defaults to 2. */
  maxAttempts?: number;
  publicationControl?: PublicationControlPolicy;
  request: RuntimeCommitRequest;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

/**
 * Options for `serveStoredCoordinatorManifest`: the manifest options with
 * the coordinator state replaced by a store and session id to load it from.
 */
export interface ServeStoredCoordinatorManifestOptions
  extends Omit<ServeCoordinatorManifestOptions, "state"> {
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

/**
 * Options for `serveStoredBlockingCoordinatorManifest`: the blocking
 * manifest options with the coordinator state replaced by a store and
 * session id to load it from.
 */
export interface ServeStoredBlockingCoordinatorManifestOptions
  extends Omit<ServeBlockingCoordinatorManifestOptions, "state"> {
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

/**
 * Failure outcomes shared by stored mutations: `conflict` (409) when
 * concurrent writes exhausted the optimistic retries — with the latest
 * snapshot when available — or `not_found` (404) when the session does not
 * exist.
 */
export type StoredRuntimeMutation =
  | {
      current?: CoordinatorPipelineSnapshot;
      response: Response;
      status: "conflict";
    }
  | {
      response: Response;
      status: "not_found";
    };

/**
 * Outcome of `issueStoredCoordinatorSlotFromRequest`: the in-memory
 * `RuntimeCoordinatorSlotIssue` outcomes — `issued` gaining the saved
 * snapshot's `etag` — plus the stored `conflict` / `not_found` failures.
 */
export type StoredRuntimeSlotIssue =
  | (Extract<RuntimeCoordinatorSlotIssue, { status: "issued" }> & {
      etag: string;
    })
  | Exclude<RuntimeCoordinatorSlotIssue, { status: "issued" }>
  | StoredRuntimeMutation;

type IssuedRuntimeCoordinatorSlotIssue = Extract<
  RuntimeCoordinatorSlotIssue,
  { status: "issued" }
>;

type SuccessfulRuntimeCoordinatorUploadCommit = Extract<
  RuntimeCoordinatorUploadCommit,
  { status: "committed" | "idempotent" }
>;

type IdempotentRuntimeCoordinatorUploadCommit =
  SuccessfulRuntimeCoordinatorUploadCommit & { status: "idempotent" };

type TerminalRuntimeCoordinatorUploadCommit = Extract<
  RuntimeCoordinatorUploadCommit,
  { status: "invalid" | "rejected" }
>;

const TERMINAL_RUNTIME_COORDINATOR_UPLOAD_COMMIT_STATUSES = [
  "invalid",
  "rejected",
] as const satisfies readonly TerminalRuntimeCoordinatorUploadCommit["status"][];

/**
 * Outcome of `commitStoredCoordinatorUploadFromRequest`: the in-memory
 * `RuntimeCoordinatorUploadCommit` outcomes — `committed` and `idempotent`
 * gaining an `etag` — plus the stored `conflict` / `not_found` failures.
 */
export type StoredRuntimeUploadCommit =
  | (SuccessfulRuntimeCoordinatorUploadCommit & {
      etag: string;
    })
  | Exclude<
      RuntimeCoordinatorUploadCommit,
      SuccessfulRuntimeCoordinatorUploadCommit
    >
  | StoredRuntimeMutation;

/**
 * Load a session's cursor and session record from the store (using the
 * store's hot-path `loadCursor` when implemented) and serve the playlist
 * matching the request URL via `serveCoordinatorManifest`. Read-only.
 * Returns a plain-text 404 when the session does not exist, and a 404 when
 * no commit has landed yet or the path matches no playlist.
 */
export async function serveStoredCoordinatorManifest(
  options: ServeStoredCoordinatorManifestOptions
): Promise<Response> {
  const view = await loadCursorView(options.store, options.sessionId);

  if (view === undefined) {
    return manifestNotFound();
  }

  const { sessionId, store, ...manifest } = options;

  return serveCoordinatorManifest({
    ...manifest,
    state: { cursor: view.cursor, session: view.session },
  });
}

/**
 * Stored variant of `serveBlockingCoordinatorManifest`: loads the session's
 * cursor view from the store, then serves the media playlist, holding
 * `_HLS_msn` / `_HLS_part` requests open via `waitForCursor` until the
 * session reaches the requested position or `timeoutMs` (milliseconds)
 * elapses. Note the loaded cursor is a point-in-time view — the wait
 * resolves against cursors pushed by the notifier, not by re-reading the
 * store. Returns a plain-text 404 when the session does not exist.
 */
export async function serveStoredBlockingCoordinatorManifest(
  options: ServeStoredBlockingCoordinatorManifestOptions
): Promise<Response> {
  const view = await loadCursorView(options.store, options.sessionId);

  if (view === undefined) {
    return manifestNotFound();
  }

  const { sessionId, store, ...manifest } = options;

  return serveBlockingCoordinatorManifest({
    ...manifest,
    state: { cursor: view.cursor, session: view.session },
  });
}

// Manifest rendering only consumes cursor + session. Prefer the store's
// hot-path read when available; fall back to a full load+extract for
// stores that don't implement it.
async function loadCursorView(
  store: CoordinatorPipelineStore,
  sessionId: OlosId
): Promise<{ cursor?: Cursor; session: Session } | undefined> {
  if (store.loadCursor !== undefined) {
    const view = await store.loadCursor(sessionId);
    if (view === undefined) {
      return;
    }
    return {
      ...(view.cursor === undefined ? {} : { cursor: view.cursor }),
      session: view.session,
    };
  }

  const snapshot = await store.load(sessionId);
  if (snapshot === undefined) {
    return;
  }
  return {
    ...(snapshot.state.cursor === undefined
      ? {}
      : { cursor: snapshot.state.cursor }),
    session: snapshot.state.session,
  };
}

/**
 * Issue an upload slot against the stored session and persist the updated
 * state via optimistic-retry (up to `maxAttempts`, default 2; a `Request`
 * body is re-cloned per attempt). Terminal `invalid` / `rejected` outcomes
 * are returned without saving; retry exhaustion yields `conflict` (409).
 */
export function issueStoredCoordinatorSlotFromRequest(
  options: IssueStoredCoordinatorSlotFromRequestOptions
): Promise<StoredRuntimeSlotIssue> {
  return Promise.resolve().then(() =>
    runStoredCoordinatorMutationWithAdaptersAndResponse<
      RuntimeCoordinatorSlotIssue,
      IssuedRuntimeCoordinatorSlotIssue,
      StoredRuntimeSlotIssue
    >({
      maxAttempts: options.maxAttempts,
      mutate: (state) =>
        issueCoordinatorSlotFromRequest({
          publicationControl: options.publicationControl,
          request: requestForAttempt(options.request),
          state,
        }),
      sessionId: options.sessionId,
      store: options.store,
      decide: (issued) =>
        isIssuedRuntimeCoordinatorSlotIssue(issued)
          ? { attempt: issued, status: "save", state: issued.state }
          : { status: "terminal", result: issued },
      onMissing: () => notFound(),
      mapSaved: (saved, attempt) => ({
        ...attempt,
        etag: saved.etag,
        state: saved.state,
      }),
      onConflictOrExhausted: (snapshot) => conflict(snapshot),
    })
  );
}

/**
 * Commit an upload against the stored session and persist the advanced
 * state via optimistic-retry (up to `maxAttempts`, default 2; a `Request`
 * body is re-cloned per attempt). Idempotent replays return the current
 * snapshot's etag without saving; `invalid` / `rejected` outcomes are
 * returned without saving; retry exhaustion yields `conflict` (409).
 */
export function commitStoredCoordinatorUploadFromRequest(
  options: CommitStoredCoordinatorUploadFromRequestOptions
): Promise<StoredRuntimeUploadCommit> {
  return Promise.resolve().then(() =>
    runStoredCoordinatorMutationWithAdaptersAndResponse<
      RuntimeCoordinatorUploadCommit,
      SuccessfulRuntimeCoordinatorUploadCommit,
      StoredRuntimeUploadCommit
    >({
      maxAttempts: options.maxAttempts,
      mutate: (state) =>
        commitCoordinatorUploadFromRequest({
          commitPolicy: options.commitPolicy,
          lateToleranceMs: options.lateToleranceMs,
          publicationControl: options.publicationControl,
          request: requestForAttempt(options.request),
          state,
        }),
      sessionId: options.sessionId,
      store: options.store,
      decide: (committed, snapshot) => {
        if (isTerminalRuntimeCoordinatorUploadCommit(committed)) {
          return { status: "terminal", result: committed };
        }

        if (isIdempotentRuntimeCoordinatorUploadCommit(committed)) {
          return {
            status: "terminal",
            result: {
              ...committed,
              etag: snapshot.etag,
            },
          };
        }

        return { attempt: committed, status: "save", state: committed.state };
      },
      onMissing: () => notFound(),
      mapSaved: (saved, attempt) => ({
        ...attempt,
        etag: saved.etag,
        state: saved.state,
      }),
      onConflictOrExhausted: (snapshot) => conflict(snapshot),
    })
  );
}

function isTerminalRuntimeCoordinatorUploadCommit(
  result: RuntimeCoordinatorUploadCommit
): result is TerminalRuntimeCoordinatorUploadCommit {
  return isAllowedString(
    result.status,
    TERMINAL_RUNTIME_COORDINATOR_UPLOAD_COMMIT_STATUSES
  );
}

function isIssuedRuntimeCoordinatorSlotIssue(
  result: RuntimeCoordinatorSlotIssue
): result is IssuedRuntimeCoordinatorSlotIssue {
  return result.status === "issued";
}

function isIdempotentRuntimeCoordinatorUploadCommit(
  result: RuntimeCoordinatorUploadCommit
): result is IdempotentRuntimeCoordinatorUploadCommit {
  return result.status === "idempotent";
}

function requestForAttempt(request: RuntimeCommitRequest): RuntimeCommitRequest;
function requestForAttempt(
  request: RuntimeSlotIssueRequest
): RuntimeSlotIssueRequest;
function requestForAttempt(
  request: RuntimeCommitRequest | RuntimeSlotIssueRequest
): RuntimeCommitRequest | RuntimeSlotIssueRequest {
  return request instanceof Request ? new Request(request) : request;
}

function notFound(): StoredRuntimeMutation {
  return {
    response: jsonErrorResponse(
      "olos.invalid_session",
      "coordinator session was not found",
      404
    ),
    status: "not_found",
  };
}

function manifestNotFound(): Response {
  return jsonErrorResponse("olos.not_found", "manifest not found", 404);
}

function conflict(
  current: CoordinatorPipelineSnapshot | undefined
): StoredRuntimeMutation {
  return {
    ...(current === undefined ? {} : { current }),
    response: jsonConflictResponse(
      "coordinator session changed during mutation"
    ),
    status: "conflict",
  };
}
