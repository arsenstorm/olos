import type { CoordinatorUploadCommit } from "../protocol";
import type { CoordinatorPipelineState } from "../protocol/coordinator";
import type { OlosError } from "../types/errors";
import type { UploadSlot } from "../types/upload-slot";
import { rejectionStatus } from "./rejection-status";
import { jsonErrorResponse, jsonResponse } from "./response";

type SuccessfulCoordinatorUploadCommit = Extract<
  CoordinatorUploadCommit,
  { status: "committed" | "idempotent" }
>;

const HTTP_BAD_REQUEST = 400;
const HTTP_CREATED = 201;
const HTTP_OK = 200;

export function invalidRuntimeCommandResponse(message: string): Response {
  return jsonErrorResponse(message, HTTP_BAD_REQUEST);
}

export function rejectedRuntimeCommandResponse(error: OlosError): Response {
  return jsonResponse(error, rejectionStatus(error));
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
