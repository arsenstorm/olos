import type {
  CoordinatorPipelineState,
  CoordinatorUploadCommit,
} from "../protocol/coordinator-types";
import type { OlosError } from "../types/errors";
import type { UploadSlot } from "../types/upload-slot";
import { rejectionStatusCode } from "./rejection-status";
import {
  jsonBadRequestResponse,
  jsonErrorResponse,
  jsonResponse,
} from "./response";

type SuccessfulCoordinatorUploadCommit = Extract<
  CoordinatorUploadCommit,
  { status: "committed" | "idempotent" }
>;

const HTTP_CREATED = 201;
const HTTP_OK = 200;

/**
 * Build the response for an invalid slot issue or upload commit. A
 * `"too_large"` status answers 413 `olos.invalid_request` instead of the
 * usual 400 response.
 */
export function invalidRuntimeCommandOutcome(
  message: string,
  status: "invalid" | "too_large" = "invalid"
): Response {
  return status === "too_large"
    ? jsonErrorResponse("olos.invalid_request", message, 413)
    : jsonBadRequestResponse(message);
}

export function rejectedRuntimeCommandResponse(error: OlosError): Response {
  return jsonResponse(error, rejectionStatusCode(error.error.code));
}

export function issuedSlotRuntimeCommandResponse(slot: UploadSlot): Response {
  return jsonResponse({ slot }, HTTP_CREATED);
}

export function committedUploadRuntimeCommandResponse(
  committed: SuccessfulCoordinatorUploadCommit
): Response {
  return jsonResponse(
    {
      commit: committed.commit,
      ...(committed.cursor === undefined ? {} : { cursor: committed.cursor }),
    },
    committed.status === "committed" ? HTTP_CREATED : HTTP_OK
  );
}

export function rejectedRuntimeCommandResult<
  State extends CoordinatorPipelineState,
>(
  error: OlosError,
  state: State
): { error: OlosError; response: Response; state: State; status: "rejected" } {
  return {
    error,
    response: rejectedRuntimeCommandResponse(error),
    state,
    status: "rejected",
  };
}
