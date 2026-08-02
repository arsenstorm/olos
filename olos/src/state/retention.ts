import type { Commit } from "../types/commit";
import type {
  CommittedSegment,
  CommittedWindow,
} from "../types/committed-window";
import type { UploadSlot } from "../types/upload-slot";
import {
  nonNegativeNumber,
  timestampMs as validTimestampMs,
} from "../validation/fields";
import { assertUploadSlot } from "../validation/upload-slot";

/** Options for {@link selectExpiredUploadSlots}. */
export interface SelectExpiredUploadSlotsOptions {
  /**
   * Grace period in milliseconds added to each slot's `expiresAt` before it
   * counts as expired; defaults to 0. Match it to the commit path's
   * `lateToleranceMs` so a retention sweep never prunes a slot whose late
   * upload would still commit.
   */
  lateToleranceMs?: number;
  /** ISO timestamp used as "now" for the expiry comparison. */
  now: string;
  slots: readonly UploadSlot[];
}

/**
 * A committed object that fell out of the retained window; its backing
 * object may be deleted from storage.
 */
export interface RetiredCommittedObject {
  commitId: string;
  objectKey: string;
  slotId: string;
}

/** Options for {@link selectRetiredCommittedObjects}. */
export interface SelectRetiredCommittedObjectsOptions {
  /** Candidate media commits to consider for retirement. */
  commits: readonly Commit[];
  /** Window whose backing objects must be kept. */
  retainedWindow: CommittedWindow;
}

type IssuedUploadSlot = UploadSlot & { state: "issued" };

/**
 * Select the slots eligible for expiry: those still in the `issued` state
 * whose `expiresAt` plus `lateToleranceMs` (default 0) is at or before
 * `now`. Slots in any other state — including `upload_observed` — are
 * never selected. Pure; throws on invalid slots, timestamps, or a negative
 * tolerance.
 */
export function selectExpiredUploadSlots(
  options: SelectExpiredUploadSlotsOptions
): UploadSlot[] {
  const now = isoTimestampMs(options.now, "now");
  const lateToleranceMs = nonNegativeNumber(
    options.lateToleranceMs ?? 0,
    "lateToleranceMs"
  );

  return options.slots.filter((slot) => {
    assertUploadSlot(slot);

    return isExpiredIssuedUploadSlot(slot, now, lateToleranceMs);
  });
}

function isExpiredIssuedUploadSlot(
  slot: UploadSlot,
  now: number,
  lateToleranceMs: number
): slot is IssuedUploadSlot {
  return (
    isIssuedUploadSlot(slot) &&
    isoTimestampMs(slot.expiresAt, "uploadSlot.expiresAt") + lateToleranceMs <=
      now
  );
}

function isIssuedUploadSlot(slot: UploadSlot): slot is IssuedUploadSlot {
  return slot.state === "issued";
}

/**
 * Select the commits whose backing objects may be deleted. A commit is
 * retired only when its media sequence number is strictly below the
 * retained window's `firstMediaSequenceNumber` and its slot does not back
 * any object still in the window; commits at or ahead of the window are
 * kept because they may still become visible (out-of-order parts, future
 * sequence numbers racing the cursor). Pure.
 */
export function selectRetiredCommittedObjects(
  options: SelectRetiredCommittedObjectsOptions
): RetiredCommittedObject[] {
  // Only retire commits whose media sequence is strictly older than the
  // retained window. Commits at or beyond firstMediaSequenceNumber may still
  // become visible (out-of-order parts that haven't formed a contiguous
  // prefix yet, or future MSNs racing ahead of the cursor) — retiring them
  // would delete backing objects that the next contiguous commit needs.
  // The slot-id check guards init commits if a caller passes them in
  // alongside media commits (in practice they live in state.initCommits).
  const retainedSlotIds = retainedWindowSlotIds(options.retainedWindow);
  const { firstMediaSequenceNumber } = options.retainedWindow;

  return options.commits
    .filter(
      (commit) =>
        commit.mediaSequenceNumber < firstMediaSequenceNumber &&
        !retainedSlotIds.has(commit.slotId)
    )
    .map(retiredCommittedObject);
}

function retainedWindowSlotIds(window: CommittedWindow): Set<string> {
  const slotIds = new Set<string>();

  for (const rendition of Object.values(window.renditions)) {
    addRenditionSlotIds(slotIds, rendition);
  }

  return slotIds;
}

function retiredCommittedObject(commit: Commit): RetiredCommittedObject {
  return {
    commitId: commit.commitId,
    objectKey: commit.objectKey,
    slotId: commit.slotId,
  };
}

function addRenditionSlotIds(
  slotIds: Set<string>,
  rendition: CommittedWindow["renditions"][string]
): void {
  slotIds.add(rendition.init.slotId);

  for (const segment of rendition.segments) {
    addSegmentSlotIds(slotIds, segment);
  }
}

function addSegmentSlotIds(
  slotIds: Set<string>,
  segment: CommittedSegment
): void {
  for (const slotId of segmentSlotIds(segment)) {
    slotIds.add(slotId);
  }
}

function segmentSlotIds(segment: CommittedSegment): string[] {
  const slotIds = segment.segment === undefined ? [] : [segment.segment.slotId];

  return [...slotIds, ...(segment.parts ?? []).map((part) => part.slotId)];
}

function isoTimestampMs(value: string, name: string): number {
  try {
    return validTimestampMs(value, name);
  } catch {
    throw new Error(`${name} must be an ISO timestamp`);
  }
}
