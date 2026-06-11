import type { Commit } from "../types/commit";
import type { CommittedWindow } from "../types/committed-window";
import type { UploadSlot } from "../types/upload-slot";
import { assertUploadSlot } from "../validation/upload-slot";

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

export function selectExpiredUploadSlots(
  options: SelectExpiredUploadSlotsOptions
): UploadSlot[] {
  const now = timestampMs(options.now, "now");

  return options.slots.filter((slot) => {
    assertUploadSlot(slot);

    return (
      slot.state === "issued" &&
      timestampMs(slot.expiresAt, "uploadSlot.expiresAt") <= now
    );
  });
}

export function selectRetiredCommittedObjects(
  options: SelectRetiredCommittedObjectsOptions
): RetiredCommittedObject[] {
  const retainedSlotIds = retainedWindowSlotIds(options.retainedWindow);

  return options.commits
    .filter((commit) => !retainedSlotIds.has(commit.slotId))
    .map((commit) => ({
      commitId: commit.commitId,
      objectKey: commit.objectKey,
      slotId: commit.slotId,
    }));
}

function retainedWindowSlotIds(window: CommittedWindow): Set<string> {
  const slotIds = new Set<string>();

  for (const rendition of Object.values(window.renditions)) {
    slotIds.add(rendition.init.slotId);

    for (const segment of rendition.segments) {
      if (segment.segment !== undefined) {
        slotIds.add(segment.segment.slotId);
      }

      for (const part of segment.parts ?? []) {
        slotIds.add(part.slotId);
      }
    }
  }

  return slotIds;
}

function timestampMs(value: string, name: string): number {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    throw new Error(`${name} must be an ISO timestamp`);
  }

  return timestamp;
}
