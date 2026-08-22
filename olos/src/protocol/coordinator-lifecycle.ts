import {
  selectExpiredUploadSlots,
  selectRetiredCommittedObjects,
} from "../state/retention";
import type { Cursor } from "../types/cursor";
import type { PublicationMode } from "../types/publication";
import type { Session } from "../types/session";
import { assertSafeDeliveryUrl } from "../validation/delivery-url";
import { assertSession } from "../validation/session";
import type {
  CoordinatorPipelineState,
  CoordinatorRetentionPlan,
  PlanCoordinatorRetentionOptions,
} from "./coordinator-types";

/**
 * Create the initial pipeline state for a new streaming session: no slots,
 * no commits, and no cursor. Validates the session and rejects unsafe
 * `deliveryBaseUrl` values (throws on either). `publicationMode` defaults to
 * `"direct-public"`.
 */
export function createCoordinatorPipeline(options: {
  deliveryBaseUrl: string;
  publicationMode?: PublicationMode;
  session: Session;
}): CoordinatorPipelineState {
  assertSession(options.session);
  assertSafeDeliveryUrl(options.deliveryBaseUrl, "deliveryBaseUrl");

  return {
    commits: [],
    initCommits: [],
    deliveryBaseUrl: options.deliveryBaseUrl,
    publicationMode: options.publicationMode ?? "direct-public",
    publisherLeases: [],
    session: options.session,
    slots: [],
  };
}

/**
 * Compute what retention would remove from a pipeline state without
 * modifying it: issued slots whose grant expired before `now` (plus
 * `lateToleranceMs`, default 0) without an upload, and commits strictly
 * older than their own track's retained window (none when there is no
 * cursor yet). Use `applyCoordinatorRetention` to also prune the state.
 */
export function planCoordinatorRetention(
  options: PlanCoordinatorRetentionOptions
): CoordinatorRetentionPlan {
  return {
    expiredSlots: selectExpiredUploadSlots({
      lateToleranceMs: options.lateToleranceMs,
      now: options.now,
      slots: options.state.slots,
    }),
    ...retainedCoordinatorCursorFields(options.state.cursor, options.state),
  };
}

function retainedCoordinatorCursorFields(
  cursor: Cursor | undefined,
  state: CoordinatorPipelineState
): Pick<CoordinatorRetentionPlan, "cursor" | "retiredObjects"> {
  if (cursor === undefined) {
    return { retiredObjects: [] };
  }

  return {
    cursor,
    retiredObjects: selectRetiredCommittedObjects({
      commits: state.commits,
      retainedWindow: cursor.committedWindow,
    }),
  };
}
