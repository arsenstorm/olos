import type {
  CoordinatorCommitPolicy,
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineStore,
} from "../protocol";
import { runStoredCoordinatorMutationWithAdaptersAndResponse } from "../protocol/mutate-coordinator-store";
import type { PublicationControlPolicy } from "../state/publication-control";
import type { Cursor } from "../types/cursor";
import type { OlosId } from "../types/ids";
import type { Session } from "../types/session";
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
import { jsonErrorResponse } from "./response";
import {
  issueCoordinatorSlotFromRequest,
  type RuntimeCoordinatorSlotIssue,
  type RuntimeSlotIssueRequest,
} from "./slot";
import { isStringLiteral } from "./string-literals";

export interface IssueStoredCoordinatorSlotFromRequestOptions {
  maxAttempts?: number;
  publicationControl?: PublicationControlPolicy;
  request: RuntimeSlotIssueRequest;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

export interface CommitStoredCoordinatorUploadFromRequestOptions {
  commitPolicy?: CoordinatorCommitPolicy;
  lateToleranceMs?: number;
  maxAttempts?: number;
  publicationControl?: PublicationControlPolicy;
  request: RuntimeCommitRequest;
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

export interface ServeStoredCoordinatorManifestOptions
  extends Omit<ServeCoordinatorManifestOptions, "state"> {
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

export interface ServeStoredBlockingCoordinatorManifestOptions
  extends Omit<ServeBlockingCoordinatorManifestOptions, "state"> {
  sessionId: OlosId;
  store: CoordinatorPipelineStore;
}

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
type TerminalStoredRuntimeUploadCommit =
  | TerminalRuntimeCoordinatorUploadCommit
  | (IdempotentRuntimeCoordinatorUploadCommit & { etag: string });

const TERMINAL_RUNTIME_COORDINATOR_UPLOAD_COMMIT_STATUSES = [
  "invalid",
  "rejected",
] as const satisfies readonly TerminalRuntimeCoordinatorUploadCommit["status"][];

export type StoredRuntimeUploadCommit =
  | (SuccessfulRuntimeCoordinatorUploadCommit & {
      etag: string;
    })
  | Exclude<
      RuntimeCoordinatorUploadCommit,
      SuccessfulRuntimeCoordinatorUploadCommit
    >
  | StoredRuntimeMutation;

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

export function issueStoredCoordinatorSlotFromRequest(
  options: IssueStoredCoordinatorSlotFromRequestOptions
): Promise<StoredRuntimeSlotIssue> {
  return Promise.resolve().then(() =>
    runStoredCoordinatorMutationWithAdaptersAndResponse<
      RuntimeCoordinatorSlotIssue,
      Exclude<RuntimeCoordinatorSlotIssue, { status: "issued" }>,
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
          ? { status: "save", state: issued.state }
          : { status: "terminal", result: issued },
      mapTerminal: (issued) => issued,
      onMissing: () => notFound(),
      mapSaved: (saved, attempt) => ({
        ...(attempt as IssuedRuntimeCoordinatorSlotIssue),
        etag: saved.etag,
        state: saved.state,
      }),
      onConflictOrExhausted: (snapshot) => conflict(snapshot),
    })
  );
}

export function commitStoredCoordinatorUploadFromRequest(
  options: CommitStoredCoordinatorUploadFromRequestOptions
): Promise<StoredRuntimeUploadCommit> {
  return Promise.resolve().then(() =>
    runStoredCoordinatorMutationWithAdaptersAndResponse<
      RuntimeCoordinatorUploadCommit,
      TerminalStoredRuntimeUploadCommit,
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

        return { status: "save", state: committed.state };
      },
      mapTerminal: (committed) => committed,
      onMissing: () => notFound(),
      mapSaved: (saved, attempt) => ({
        ...(attempt as RuntimeCoordinatorUploadCommit),
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
  return isStringLiteral(
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
    response: jsonErrorResponse("coordinator session was not found", 404),
    status: "not_found",
  };
}

function manifestNotFound(): Response {
  return new Response("manifest not found", {
    headers: { "content-type": "text/plain; charset=utf-8" },
    status: 404,
  });
}

function conflict(
  current: CoordinatorPipelineSnapshot | undefined
): StoredRuntimeMutation {
  return {
    ...(current === undefined ? {} : { current }),
    response: jsonErrorResponse(
      "coordinator session changed during mutation",
      409
    ),
    status: "conflict",
  };
}
