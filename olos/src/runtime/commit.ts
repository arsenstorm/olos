import {
  type CoordinatorCommitPolicy,
  type CoordinatorUploadCommit,
  commitCoordinatorUpload,
} from "../protocol";
import type { CoordinatorPipelineState } from "../protocol/coordinator";
import { createObservedUpload } from "../state/observed-upload";
import type { PublicationControlPolicy } from "../state/publication-control";
import type { OlosError } from "../types/errors";
import {
  parseRuntimeCommitPayloadRequest,
  type RuntimeCommitPayload,
} from "./commit-payload-parser";
import { errorMessage } from "./errors";
import { rejectionStatus } from "./rejection-status";
import type { RuntimeJsonRequestParse } from "./request-json";
import { jsonErrorResponse, jsonResponse } from "./response";

export type RuntimeCommitRequest = Request | RuntimeCommitPayload;

export interface CommitCoordinatorUploadFromRequestOptions {
  commitPolicy?: CoordinatorCommitPolicy;
  lateToleranceMs?: number;
  publicationControl?: PublicationControlPolicy;
  request: RuntimeCommitRequest;
  state: CoordinatorPipelineState;
}

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
type RuntimeCommitRequestParse = RuntimeJsonRequestParse<
  RuntimeCommitPayload,
  InvalidRuntimeCoordinatorUploadCommit
>;

export async function commitCoordinatorUploadFromRequest(
  options: CommitCoordinatorUploadFromRequestOptions
): Promise<RuntimeCoordinatorUploadCommit> {
  const payload = await parseRequest(options.request);

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
    });

    if (isRejectedCoordinatorUploadCommit(committed)) {
      return {
        error: committed.error,
        response: jsonResponse(
          committed.error,
          rejectionStatus(committed.error)
        ),
        state: committed.state,
        status: "rejected",
      };
    }

    return {
      response: jsonResponse(
        {
          commit: committed.commit,
          ...(committed.cursor === undefined
            ? {}
            : { cursor: committed.cursor }),
        },
        committed.status === "committed" ? 201 : 200
      ),
      state: committed.state,
      status: committed.status,
    };
  } catch (error) {
    return invalid(errorMessage(error, "invalid commit request"));
  }
}

function isRejectedCoordinatorUploadCommit(
  result: CoordinatorUploadCommit
): result is RejectedCoordinatorUploadCommit {
  return result.status === "rejected";
}

async function parseRequest(
  request: RuntimeCommitRequest
): Promise<RuntimeCommitRequestParse> {
  return await parseRuntimeCommitPayloadRequest(
    request,
    invalid,
    "invalid commit request"
  );
}

function invalid(message: string): InvalidRuntimeCoordinatorUploadCommit {
  return {
    message,
    response: jsonErrorResponse(message, 400),
    status: "invalid",
  };
}
