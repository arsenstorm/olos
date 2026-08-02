import {
  selectExpiredUploadSlots,
  selectRetiredCommittedObjects,
} from "../state/retention";
import type { CommittedWindow } from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import type { Session } from "../types/session";
import type { PublicationMode } from "../types/upload-slot";
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
 * `mediaBaseUrl` values (throws on either). `publicationMode` defaults to
 * `"direct-public"`.
 */
export function createCoordinatorPipeline(options: {
  mediaBaseUrl: string;
  publicationMode?: PublicationMode;
  session: Session;
}): CoordinatorPipelineState {
  assertSession(options.session);
  assertSafeDeliveryUrl(options.mediaBaseUrl, "mediaBaseUrl");

  return {
    commits: [],
    initCommits: [],
    mediaBaseUrl: options.mediaBaseUrl,
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
 * older than the cursor's committed window (none when there is no cursor
 * yet). Use `applyCoordinatorRetention` to also prune the state.
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
    retiredObjects: retainedCoordinatorObjects(
      state.commits,
      cursor.committedWindow
    ),
  };
}

function retainedCoordinatorObjects(
  commits: CoordinatorPipelineState["commits"],
  retainedWindow: CommittedWindow
): CoordinatorRetentionPlan["retiredObjects"] {
  return selectRetiredCommittedObjects({
    commits,
    retainedWindow,
  });
}
