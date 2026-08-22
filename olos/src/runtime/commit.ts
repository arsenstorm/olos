import { commitCoordinatorUpload } from "../protocol/coordinator-commit";
import type {
  CoordinatorCommitPolicy,
  CoordinatorPipelineState,
  CoordinatorUploadCommit,
} from "../protocol/coordinator-types";
import type { CreateCommittedWindowOptions } from "../state/committed-window";
import { createObservedUpload } from "../state/observed-upload";
import type { PublicationControlPolicy } from "../state/publication-control";
import type { OlosError } from "../types/errors";
import { errorMessage } from "../validation/fields";
import {
  committedUploadRuntimeCommandResponse,
  invalidRuntimeCommandOutcome,
  rejectedRuntimeCommandResult,
} from "./command-response";
import {
  parseRuntimeCommitPayloadRequest,
  type RuntimeCommitPayload,
} from "./commit-payload-parser";

/**
 * Commit input: either a web `Request` whose JSON body is parsed and
 * validated, or an already-built payload object.
 */
export type RuntimeCommitRequest = Request | RuntimeCommitPayload;
export type {
  ParsedObservedUploadPayload as RuntimeObservedUploadPayload,
  RuntimeCommitPayload,
} from "./commit-payload-parser";

/** Options for `commitCoordinatorUploadFromRequest`. */
export interface CommitCoordinatorUploadFromRequestOptions {
  commitPolicy?: CoordinatorCommitPolicy;
  /**
   * How far behind the cursor a commit may land and still be accepted, in
   * milliseconds. A `lateToleranceMs` in the payload takes precedence.
   */
  lateToleranceMs?: number;
  publicationControl?: PublicationControlPolicy;
  request: RuntimeCommitRequest;
  /** Coordinator state the commit is applied to (not mutated in place). */
  state: CoordinatorPipelineState;
  /** Profile hook for track window `profile` data; see `createCommittedWindow`. */
  trackWindowProfile?: CreateCommittedWindowOptions["trackWindowProfile"];
}

/**
 * Outcome of `commitCoordinatorUploadFromRequest`. Every variant carries a
 * ready-to-return JSON `response`; `committed` and `idempotent` also carry
 * the next coordinator state, `rejected` the protocol error and unchanged
 * state, and `invalid` the parse or validation failure message.
 */
export type RuntimeCoordinatorUploadCommit =
  | {
      response: Response;
      state: CoordinatorPipelineState;
      status: "committed" | "idempotent";
    }
  | {
      error: OlosError;
      response: Response;
      state: CoordinatorPipelineState;
      status: "rejected";
    }
  | {
      message: string;
      response: Response;
      status: "invalid";
    };

type RejectedCoordinatorUploadCommit = Extract<
  CoordinatorUploadCommit,
  { status: "rejected" }
>;
type InvalidRuntimeCoordinatorUploadCommit = Extract<
  RuntimeCoordinatorUploadCommit,
  { status: "invalid" }
>;
/**
 * Apply an upload commit against in-memory coordinator state and build the
 * matching HTTP response. Pure with respect to storage — the caller is
 * responsible for persisting the returned state (see
 * `commitStoredCoordinatorUploadFromRequest` for the stored variant).
 * Replaying a commit the state already contains yields `idempotent`;
 * protocol-level refusals (unknown or expired slot, publication control)
 * yield `rejected` with an `OlosError`; malformed payloads yield `invalid`.
 */
export async function commitCoordinatorUploadFromRequest(
  options: CommitCoordinatorUploadFromRequestOptions
): Promise<RuntimeCoordinatorUploadCommit> {
  const payload = await parseRuntimeCommitPayloadRequest(
    options.request,
    invalidUploadCommit,
    "invalid commit request"
  );

  if (payload.status === "invalid") {
    return payload;
  }

  try {
    const committed = commitCoordinatorUpload({
      ...payload.value,
      commitPolicy: options.commitPolicy,
      lateToleranceMs: payload.value.lateToleranceMs ?? options.lateToleranceMs,
      object: createObservedUpload(payload.value.object),
      publicationControl: options.publicationControl,
      state: options.state,
      trackWindowProfile: options.trackWindowProfile,
    });

    if (isRejectedCoordinatorUploadCommit(committed)) {
      return rejectedRuntimeCommandResult(committed.error, committed.state);
    }

    return {
      response: committedUploadRuntimeCommandResponse(committed),
      state: committed.state,
      status: committed.status,
    };
  } catch (error) {
    return invalidUploadCommit(errorMessage(error, "invalid commit request"));
  }
}

function isRejectedCoordinatorUploadCommit(
  result: CoordinatorUploadCommit
): result is RejectedCoordinatorUploadCommit {
  return result.status === "rejected";
}

/**
 * Build an `invalid` upload commit outcome. A `"too_large"` status answers
 * 413 `olos.invalid_request` instead of the usual 400 response.
 */
export function invalidUploadCommit(
  message: string,
  status: "invalid" | "too_large" = "invalid"
): InvalidRuntimeCoordinatorUploadCommit {
  return {
    message,
    response: invalidRuntimeCommandOutcome(message, status),
    status: "invalid",
  };
}
