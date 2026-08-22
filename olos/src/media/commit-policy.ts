import type { CoordinatorCommitPolicy } from "../protocol/coordinator-types";
import { createOlosError } from "../types/errors";
import { errorMessage } from "../validation/fields";
import { CMAF_LLHLS_PROFILE_ID } from "./types";
import { assertMediaObjectProfile } from "./validation";

/**
 * Commit policy for the CMAF/LL-HLS profile: segment and part commits must
 * carry a positive `profile.duration`. Sessions running another profile and
 * init objects are always allowed, so it is safe as a runtime default.
 */
export const mediaCommitPolicy: CoordinatorCommitPolicy = (context) => {
  if (
    context.state.session.profile.id !== CMAF_LLHLS_PROFILE_ID ||
    context.slot.kind === "init"
  ) {
    return { status: "allowed" };
  }

  try {
    assertMediaObjectProfile(context.profile ?? {}, "commit.profile", {
      requireDuration: true,
    });
    return { status: "allowed" };
  } catch (error) {
    return {
      error: createOlosError(
        "olos.invalid_request",
        errorMessage(error, "commit.profile is invalid"),
        { slotId: context.slot.slotId }
      ),
      status: "rejected",
    };
  }
};
