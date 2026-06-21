import { issueCoordinatorSlot } from "../protocol";
import type { CoordinatorPipelineState } from "../protocol/coordinator";
import {
  type PublicationControlPolicy,
  type PublicationControlResolution,
  resolvePublicationControl,
} from "../state/publication-control";
import type { OlosError } from "../types/errors";
import type { UploadSlot } from "../types/upload-slot";
import {
  invalidRuntimeCommandResponse,
  issuedSlotRuntimeCommandResponse,
  rejectedRuntimeCommandResult,
} from "./command-response";
import { errorMessage } from "./errors";
import type { RuntimeSlotIssuePayload } from "./slot-issue-payload";
import { parseSlotIssueRequest } from "./slot-issue-request-parser";
export type RuntimeSlotIssueRequest = Request | RuntimeSlotIssuePayload;

export interface IssueCoordinatorSlotFromRequestOptions {
  publicationControl?: PublicationControlPolicy;
  request: RuntimeSlotIssueRequest;
  state: CoordinatorPipelineState;
}

export type RuntimeCoordinatorSlotIssue =
  | {
      response: Response;
      slot: UploadSlot;
      state: CoordinatorPipelineState;
      status: "issued";
    }
  | {
      message: string;
      response: Response;
      status: "invalid";
    }
  | {
      error: OlosError;
      response: Response;
      state: CoordinatorPipelineState;
      status: "rejected";
    };

type BlockedPublicationControl = Extract<
  PublicationControlResolution,
  { status: "blocked" }
>;
type InvalidRuntimeCoordinatorSlotIssue = Extract<
  RuntimeCoordinatorSlotIssue,
  { status: "invalid" }
>;
export async function issueCoordinatorSlotFromRequest(
  options: IssueCoordinatorSlotFromRequestOptions
): Promise<RuntimeCoordinatorSlotIssue> {
  const payload = await parseSlotIssueRequest(
    options.request,
    invalid,
    "invalid slot issue request"
  );

  if (payload.status === "invalid") {
    return payload;
  }

  const publication = resolvePublicationControl({
    operation: "issue_slot",
    policy: options.publicationControl,
  });

  if (isBlockedPublicationControl(publication)) {
    return rejectedRuntimeCommandResult(publication.error, options.state);
  }

  try {
    const issued = issueCoordinatorSlot({
      ...payload.value,
      publicationControl: options.publicationControl,
      state: options.state,
    });

    return {
      response: issuedSlotRuntimeCommandResponse(issued.slot),
      slot: issued.slot,
      state: issued.state,
      status: "issued",
    };
  } catch (error) {
    return invalid(errorMessage(error, "invalid slot issue request"));
  }
}

function invalid(message: string): InvalidRuntimeCoordinatorSlotIssue {
  return {
    message,
    response: invalidRuntimeCommandResponse(message),
    status: "invalid",
  };
}

function isBlockedPublicationControl(
  result: PublicationControlResolution
): result is BlockedPublicationControl {
  return result.status === "blocked";
}
