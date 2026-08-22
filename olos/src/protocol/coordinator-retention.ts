import type { RetiredCommittedObject } from "../state/retention";
import type { UploadSlot } from "../types/upload-slot";
import { planCoordinatorRetention } from "./coordinator-lifecycle";
import type { CoordinatorPipelineState } from "./coordinator-types";

/** Options for `applyCoordinatorRetention`. */
export interface ApplyCoordinatorRetentionOptions {
  /**
   * Grace period in milliseconds added to each slot's `expiresAt` before it
   * counts as expired; defaults to 0. Match it to the commit path's
   * `lateToleranceMs` so pruning never removes a slot whose late upload
   * would still commit.
   */
  lateToleranceMs?: number;
  /** ISO timestamp used to decide which issued slots have expired. */
  now: string;
  state: CoordinatorPipelineState;
}

/** Result of `applyCoordinatorRetention`: the pruned state plus what fell. */
export interface CoordinatorRetentionApplication {
  /** Issued slots whose grant expired without an upload; no backing object. */
  expiredSlots: readonly UploadSlot[];
  /** Pruned commits; callers should delete their backing storage objects. */
  retiredObjects: readonly RetiredCommittedObject[];
  /** Same reference as the input state when nothing qualified for pruning. */
  state: CoordinatorPipelineState;
}

/**
 * Prune commits whose slots have fallen behind the retained window AND their
 * matching slots from `state.slots`; also prune issued slots whose grant
 * expired without an upload. Without this both arrays accumulate forever,
 * the persisted snapshot grows linearly with session age, and every read
 * pays O(session-age) JSON parse + scan. The pruned commits surface as
 * `retiredObjects` so callers can delete their backing objects from storage;
 * expired-issued slot grants have no uploaded object so they only appear in
 * `expiredSlots`. This is the single pruning core shared by the commit path
 * (auto-retention on every commit) and the standalone retention flows so the
 * two cannot drift. When nothing qualifies, the input state is returned
 * unchanged (same reference) so callers can skip redundant saves.
 */
export function applyCoordinatorRetention(
  options: ApplyCoordinatorRetentionOptions
): CoordinatorRetentionApplication {
  const plan = planCoordinatorRetention({
    lateToleranceMs: options.lateToleranceMs,
    now: options.now,
    state: options.state,
  });

  if (plan.expiredSlots.length === 0 && plan.retiredObjects.length === 0) {
    return {
      expiredSlots: plan.expiredSlots,
      retiredObjects: plan.retiredObjects,
      state: options.state,
    };
  }

  const obsoleteSlotIds = new Set([
    ...plan.retiredObjects.map((object) => object.slotId),
    ...plan.expiredSlots.map((slot) => slot.slotId),
  ]);

  return {
    expiredSlots: plan.expiredSlots,
    retiredObjects: plan.retiredObjects,
    state: {
      ...options.state,
      commits: options.state.commits.filter(
        (commit) => !obsoleteSlotIds.has(commit.slotId)
      ),
      slots: options.state.slots.filter(
        (slot) => !obsoleteSlotIds.has(slot.slotId)
      ),
    },
  };
}
