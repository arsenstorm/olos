import { assertPublicationAllowed } from "../state/publication-control";
import {
  canTransitionUploadSlot,
  createIssuedUploadSlot,
  revokeUpload,
} from "../state/upload-slot";
import type { OlosId } from "../types/ids";
import type { UploadSlot } from "../types/upload-slot";
import type {
  CoordinatorPipelineState,
  CoordinatorSlotIssue,
  CoordinatorUploadRevocation,
  IssueCoordinatorSlotOptions,
  RevokeCoordinatorUploadOptions,
} from "./coordinator";
import { coordinatorError } from "./coordinator-error";

export function issueCoordinatorSlot(
  options: IssueCoordinatorSlotOptions
): CoordinatorSlotIssue {
  assertPublicationAllowed({
    operation: "issue_slot",
    policy: options.publicationControl,
  });

  if (findSlot(options.state, options.slotId) !== undefined) {
    throw new Error("slotId must be unique");
  }

  const slot = createIssuedUploadSlot({
    ...options,
    session: options.state.session,
  });

  return {
    slot,
    state: {
      ...options.state,
      slots: [...options.state.slots, slot],
    },
  };
}

export function revokeCoordinatorUpload(
  options: RevokeCoordinatorUploadOptions
): CoordinatorUploadRevocation {
  const slot = findSlot(options.state, options.slotId);

  if (slot === undefined) {
    return {
      error: coordinatorError(
        "olos.unknown_slot",
        "upload slot was not found",
        {
          slotId: options.slotId,
        }
      ),
      state: options.state,
      status: "rejected",
    };
  }

  if (isSlotInCursor(options.state, slot)) {
    return {
      error: coordinatorError(
        "olos.invalid_state",
        "announced upload slots cannot be silently revoked",
        { slotId: slot.slotId, state: slot.state }
      ),
      state: options.state,
      status: "rejected",
    };
  }

  if (
    slot.state !== "revoked" &&
    !canTransitionUploadSlot(slot.state, "revoked")
  ) {
    return {
      error: coordinatorError(
        "olos.invalid_state",
        "upload slot cannot be revoked from its current state",
        { slotId: slot.slotId, state: slot.state }
      ),
      state: options.state,
      status: "rejected",
    };
  }

  const result = revokeUpload({ slot });

  return {
    slot: result,
    state: removeSlotCommit({
      slot: result,
      state: options.state,
    }),
    status: slot.state === "revoked" ? "already_revoked" : "revoked",
  };
}

function findSlot(
  state: CoordinatorPipelineState,
  slotId: OlosId
): UploadSlot | undefined {
  return state.slots.find((slot) => slot.slotId === slotId);
}

function isSlotInCursor(
  state: CoordinatorPipelineState,
  slot: UploadSlot
): boolean {
  const cursor = state.cursor;

  if (cursor === undefined) {
    return false;
  }

  return Object.values(cursor.committedWindow.renditions).some((rendition) => {
    if (rendition.init.slotId === slot.slotId) {
      return true;
    }

    return rendition.segments.some(
      (segment) =>
        segment.segment?.slotId === slot.slotId ||
        segment.parts?.some((part) => part.slotId === slot.slotId) === true
    );
  });
}

function removeSlotCommit(options: {
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}): CoordinatorPipelineState {
  return {
    ...options.state,
    commits: options.state.commits.filter(
      (commit) => commit.slotId !== options.slot.slotId
    ),
    initCommits: options.state.initCommits.filter(
      (commit) => commit.slotId !== options.slot.slotId
    ),
    slots: options.state.slots.map((slot) =>
      slot.slotId === options.slot.slotId ? options.slot : slot
    ),
  };
}
