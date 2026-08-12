import {
  lastVisiblePartNumber,
  tryCreateCommittedWindow,
} from "../state/committed-window";
import { createCursor, resolveCursorUpdate } from "../state/cursor";
import type { RetiredCommittedObject } from "../state/retention";
import type { Commit } from "../types/commit";
import type { CommittedWindow } from "../types/committed-window";
import type { Cursor } from "../types/cursor";
import type { UploadSlot } from "../types/upload-slot";
import { applyCoordinatorRetention } from "./coordinator-retention";
import type { CoordinatorPipelineState } from "./coordinator-types";

export interface CommitIntoStateResult {
  retiredObjects: readonly RetiredCommittedObject[];
  state: CoordinatorPipelineState;
}

export interface CommitIntoStateOptions {
  commit: Commit;
  lateToleranceMs?: number;
  maxSegments?: number;
  slot: UploadSlot;
  state: CoordinatorPipelineState;
}

/**
 * Fold an accepted commit into the pipeline state: record it against its
 * slot, then advance the cursor and prune whatever left the window. The
 * commit is always recorded; whether it becomes visible depends on the
 * contiguous-prefix rule.
 */
export function commitIntoState(
  options: CommitIntoStateOptions
): CommitIntoStateResult {
  const nextState = recordCommit(options);

  // A window needs an init commit and at least one media commit before any
  // of it can become visible.
  if (nextState.initCommits.length === 0 || nextState.commits.length === 0) {
    return { retiredObjects: [], state: nextState };
  }

  const committedWindow = tryCreateCommittedWindow({
    commits: nextState.commits,
    epoch: options.state.session.epoch,
    initCommits: nextState.initCommits,
    maxSegments: options.maxSegments,
    sessionId: options.state.session.sessionId,
  });

  // Out-of-order commit at the same media sequence — the contiguous-prefix
  // rule means no parts qualify for the manifest yet. The commit is still
  // recorded in state.commits; the cursor stays at whatever it was, and
  // the next contiguous commit will advance it.
  if (committedWindow === undefined) {
    return { retiredObjects: [], state: nextState };
  }

  return advanceAndRetain(options, nextState, committedWindow);
}

/** Merge the commit and its observed slot into state, without advancing. */
function recordCommit(
  options: CommitIntoStateOptions
): CoordinatorPipelineState {
  const isInit = options.slot.kind === "init";

  return {
    ...options.state,
    commits: isInit
      ? options.state.commits
      : [...options.state.commits, options.commit],
    initCommits: isInit
      ? [...options.state.initCommits, options.commit]
      : options.state.initCommits,
    slots: options.state.slots.map((slot) =>
      slot.slotId === options.slot.slotId ? options.slot : slot
    ),
  };
}

/** Advance the cursor onto the new window, then prune what left it. */
function advanceAndRetain(
  options: CommitIntoStateOptions,
  nextState: CoordinatorPipelineState,
  committedWindow: CommittedWindow
): CommitIntoStateResult {
  // Derive from the visible window, not raw commits: an out-of-order future
  // commit (e.g. part 3 arriving before parts 0–2) is filtered out of the
  // window by the contiguous-prefix rule, so its partNumber must not leak
  // into the cursor.
  const partNumber = lastVisiblePartNumber(committedWindow);
  const candidateCursor = createCursor({
    committedWindow,
    latencyProfile: options.state.session.latencyProfile,
    mediaBaseUrl: options.state.mediaBaseUrl,
    partTarget: options.state.session.partTarget,
    segmentTarget: options.state.session.segmentTarget,
    sessionId: options.state.session.sessionId,
    state: options.state.session.state,
    updatedAt: options.commit.committedAt,
    ...(partNumber === undefined ? {} : { lastPartNumber: partNumber }),
  });

  // Auto-retention on every window advance: the shared pruning core drops
  // out-of-window commits and expired issued slots so the persisted snapshot
  // stays bounded, surfacing the pruned commits as `retiredObjects` for the
  // runtime to delete their backing objects in the same operation. The
  // commit's `lateToleranceMs` carries into pruning so a slot whose late
  // upload would still commit is never expired here.
  const cursor = resolveNextCursor(options.state.cursor, candidateCursor);
  const retention = applyCoordinatorRetention({
    lateToleranceMs: options.lateToleranceMs,
    now: options.commit.committedAt,
    state: { ...nextState, cursor },
  });

  return { retiredObjects: retention.retiredObjects, state: retention.state };
}

/** The cursor never regresses: a stale candidate leaves the current one. */
function resolveNextCursor(
  current: Cursor | undefined,
  candidate: Cursor
): Cursor {
  if (current === undefined) {
    return candidate;
  }

  const update = resolveCursorUpdate({
    candidateCursor: candidate,
    currentCursor: current,
  });

  return update.status === "regression" ? current : update.cursor;
}
