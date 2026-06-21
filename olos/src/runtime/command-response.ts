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

export function invalidRuntimeCommandResponse(message: string): Response {
  return jsonErrorResponse(message, 400);
}

export function rejectedRuntimeCommandResponse(error: OlosError): Response {
  return jsonResponse(error, rejectionStatus(error));
}

export function issuedSlotRuntimeCommandResponse(slot: UploadSlot): Response {
  return jsonResponse({ slot }, 201);
}

export function committedUploadRuntimeCommandResponse(
  committed: SuccessfulCoordinatorUploadCommit
): Response {
  return jsonResponse(
    {
      commit: committed.commit,
      ...(committed.cursor === undefined ? {} : { cursor: committed.cursor }),
    },
    committed.status === "committed" ? 201 : 200
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
