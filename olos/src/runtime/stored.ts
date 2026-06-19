import type {
  CoordinatorCommitPolicy,
  CoordinatorPipelineSnapshot,
  CoordinatorPipelineStore,
} from "../protocol";
import type { PublicationControlPolicy } from "../state/publication-control";
import type { OlosId } from "../types/ids";
import { positiveAttempts } from "./attempts";
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
import { jsonResponse } from "./response";
import {
  issueCoordinatorSlotFromRequest,
  type RuntimeCoordinatorSlotIssue,
  type RuntimeSlotIssueRequest,
} from "./slot";

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

type IdempotentRuntimeCoordinatorUploadCommit = Extract<
  RuntimeCoordinatorUploadCommit,
  { status: "committed" | "idempotent" }
> & { status: "idempotent" };

type TerminalRuntimeCoordinatorUploadCommit = Extract<
  RuntimeCoordinatorUploadCommit,
  { status: "invalid" | "rejected" }
>;

type CoordinatorStoreSaveResult = Awaited<
  ReturnType<CoordinatorPipelineStore["save"]>
>;

type SavedCoordinatorStoreResult = Extract<
  CoordinatorStoreSaveResult,
  { status: "saved" }
>;

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
  const snapshot = await options.store.load(options.sessionId);

  if (snapshot === undefined) {
    return manifestNotFound();
  }

  const { sessionId, store, ...manifest } = options;

  return serveCoordinatorManifest({
    ...manifest,
    state: snapshot.state,
  });
}

export async function serveStoredBlockingCoordinatorManifest(
  options: ServeStoredBlockingCoordinatorManifestOptions
): Promise<Response> {
  const snapshot = await options.store.load(options.sessionId);

  if (snapshot === undefined) {
    return manifestNotFound();
  }

  const { sessionId, store, ...manifest } = options;

  return await serveBlockingCoordinatorManifest({
    ...manifest,
    state: snapshot.state,
  });
}

export async function issueStoredCoordinatorSlotFromRequest(
  options: IssueStoredCoordinatorSlotFromRequestOptions
): Promise<StoredRuntimeSlotIssue> {
  const attempts = positiveAttempts(options.maxAttempts);
  let snapshot = await options.store.load(options.sessionId);

  if (snapshot === undefined) {
    return notFound();
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const issued = await issueCoordinatorSlotFromRequest({
      publicationControl: options.publicationControl,
      request: requestForAttempt(options.request),
      state: snapshot.state,
    });

    if (!isIssuedRuntimeCoordinatorSlotIssue(issued)) {
      return issued;
    }

    const saved = await options.store.save({
      expectedEtag: snapshot.etag,
      sessionId: options.sessionId,
      state: issued.state,
    });

    if (isSavedCoordinatorStoreResult(saved)) {
      return {
        ...issued,
        etag: saved.etag,
        state: saved.state,
      };
    }

    if (saved.current === undefined) {
      return conflict(saved.current);
    }

    snapshot = saved.current;
  }

  return conflict(snapshot);
}

export async function commitStoredCoordinatorUploadFromRequest(
  options: CommitStoredCoordinatorUploadFromRequestOptions
): Promise<StoredRuntimeUploadCommit> {
  const attempts = positiveAttempts(options.maxAttempts);
  let snapshot = await options.store.load(options.sessionId);

  if (snapshot === undefined) {
    return notFound();
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const committed = await commitCoordinatorUploadFromRequest({
      commitPolicy: options.commitPolicy,
      lateToleranceMs: options.lateToleranceMs,
      publicationControl: options.publicationControl,
      request: requestForAttempt(options.request),
      state: snapshot.state,
    });

    if (isTerminalRuntimeCoordinatorUploadCommit(committed)) {
      return committed;
    }

    if (isIdempotentRuntimeCoordinatorUploadCommit(committed)) {
      return {
        ...committed,
        etag: snapshot.etag,
      };
    }

    const saved = await options.store.save({
      expectedEtag: snapshot.etag,
      sessionId: options.sessionId,
      state: committed.state,
    });

    if (isSavedCoordinatorStoreResult(saved)) {
      return {
        ...committed,
        etag: saved.etag,
        state: saved.state,
      };
    }

    if (saved.current === undefined) {
      return conflict(saved.current);
    }

    snapshot = saved.current;
  }

  return conflict(snapshot);
}

function isTerminalRuntimeCoordinatorUploadCommit(
  result: RuntimeCoordinatorUploadCommit
): result is TerminalRuntimeCoordinatorUploadCommit {
  return TERMINAL_RUNTIME_COORDINATOR_UPLOAD_COMMIT_STATUSES.includes(
    result.status as TerminalRuntimeCoordinatorUploadCommit["status"]
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

function isSavedCoordinatorStoreResult(
  result: CoordinatorStoreSaveResult
): result is SavedCoordinatorStoreResult {
  return result.status === "saved";
}

function requestForAttempt<RequestType extends RuntimeCommitRequest>(
  request: RequestType
): RequestType;
function requestForAttempt<RequestType extends RuntimeSlotIssueRequest>(
  request: RequestType
): RequestType;
function requestForAttempt<RequestType extends Request | object>(
  request: RequestType
): RequestType {
  return request instanceof Request
    ? (request.clone() as RequestType)
    : request;
}

function notFound(): StoredRuntimeMutation {
  return {
    response: jsonResponse(
      { error: { message: "coordinator session was not found" } },
      404
    ),
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
    response: jsonResponse(
      { error: { message: "coordinator session changed during mutation" } },
      409
    ),
    status: "conflict",
  };
}
