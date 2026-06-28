import type { Commit } from "../types/commit";
import type {
  CommittedSegment,
  CommittedWindow,
} from "../types/committed-window";
import type { UploadSlot } from "../types/upload-slot";
import { assertUploadSlot } from "../validation/upload-slot";
import { timestampMs as validTimestampMs } from "./timestamp";

export interface SelectExpiredUploadSlotsOptions {
  now: string;
  slots: readonly UploadSlot[];
}

export interface RetiredCommittedObject {
  commitId: string;
  objectKey: string;
  slotId: string;
}

export interface SelectRetiredCommittedObjectsOptions {
  commits: readonly Commit[];
  retainedWindow: CommittedWindow;
}

type IssuedUploadSlot = UploadSlot & { state: "issued" };

export function selectExpiredUploadSlots(
  options: SelectExpiredUploadSlotsOptions
): UploadSlot[] {
  const now = isoTimestampMs(options.now, "now");

  return options.slots.filter((slot) => {
    assertUploadSlot(slot);

    return isExpiredIssuedUploadSlot(slot, now);
  });
}

function isExpiredIssuedUploadSlot(
  slot: UploadSlot,
  now: number
): slot is IssuedUploadSlot {
  return (
    isIssuedUploadSlot(slot) &&
    isoTimestampMs(slot.expiresAt, "uploadSlot.expiresAt") <= now
  );
}

function isIssuedUploadSlot(slot: UploadSlot): slot is IssuedUploadSlot {
  return slot.state === "issued";
}

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
