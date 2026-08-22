import { issueCoordinatorSlot } from "../protocol/coordinator-slot";
import type { CoordinatorPipelineState } from "../protocol/coordinator-types";
import {
  type PublicationControlPolicy,
  type PublicationControlResolution,
  resolvePublicationControl,
} from "../state/publication-control";
import type { OlosError } from "../types/errors";
import type { UploadSlot } from "../types/upload-slot";
import { errorMessage } from "../validation/fields";
import {
  invalidRuntimeCommandOutcome,
  issuedSlotRuntimeCommandResponse,
  rejectedRuntimeCommandResult,
} from "./command-response";
import {
  parseSlotIssueRequest,
  type RuntimeSlotIssuePayload,
} from "./slot-issue-payload";
/**
 * Slot issue input: either a web `Request` whose JSON body is parsed and
 * validated, or an already-built payload object.
 */
export type RuntimeSlotIssueRequest = Request | RuntimeSlotIssuePayload;
export type { RuntimeSlotIssuePayload } from "./slot-issue-payload";

/** Options for `issueCoordinatorSlotFromRequest`. */
export interface IssueCoordinatorSlotFromRequestOptions {
  publicationControl?: PublicationControlPolicy;
  request: RuntimeSlotIssueRequest;
  /** Coordinator state the slot is issued against (not mutated in place). */
  state: CoordinatorPipelineState;
}

/**
 * Outcome of `issueCoordinatorSlotFromRequest`. Every variant carries a
 * ready-to-return JSON `response`; `issued` also carries the slot and next
 * coordinator state, `rejected` the protocol error and unchanged state, and
 * `invalid` the parse or validation failure message.
 */
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
/**
 * Issue an upload slot against in-memory coordinator state and build the
 * matching HTTP response. Pure with respect to storage — the caller is
 * responsible for persisting the returned state (see
 * `issueStoredCoordinatorSlotFromRequest` for the stored variant). The
 * issued slot carries the coordinator-derived object key and delivery URL.
 * Publication-control blocks yield `rejected` with an `OlosError`;
 * malformed payloads yield `invalid`.
 */
export async function issueCoordinatorSlotFromRequest(
  options: IssueCoordinatorSlotFromRequestOptions
): Promise<RuntimeCoordinatorSlotIssue> {
  const payload = await parseSlotIssueRequest(
    options.request,
    invalidSlotIssue,
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
    return invalidSlotIssue(errorMessage(error, "invalid slot issue request"));
  }
}

/**
 * Build an `invalid` slot issue outcome. A `"too_large"` status answers 413
 * `olos.invalid_request` instead of the usual 400 response.
 */
export function invalidSlotIssue(
  message: string,
  status: "invalid" | "too_large" = "invalid"
): InvalidRuntimeCoordinatorSlotIssue {
  return {
    message,
    response: invalidRuntimeCommandOutcome(message, status),
    status: "invalid",
  };
}

function isBlockedPublicationControl(
  result: PublicationControlResolution
): result is BlockedPublicationControl {
  return result.status === "blocked";
}
