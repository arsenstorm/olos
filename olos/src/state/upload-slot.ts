import { UPLOAD_SLOT_TRANSITIONS } from "../config/upload-slot";
import type { UploadSlotState } from "../types/upload-slot";

export function canTransitionUploadSlot(
  from: UploadSlotState,
  to: UploadSlotState
): boolean {
  return allowedUploadSlotTransitions(from).includes(to);
}

export function assertUploadSlotTransition(
  from: UploadSlotState,
  to: UploadSlotState
): void {
  if (canTransitionUploadSlot(from, to)) {
    return;
  }

  throw new Error(`Invalid upload slot transition: ${from} -> ${to}`);
}

function allowedUploadSlotTransitions(
  from: UploadSlotState
): readonly UploadSlotState[] {
  const transitions: Partial<
    Record<UploadSlotState, readonly UploadSlotState[]>
  > = UPLOAD_SLOT_TRANSITIONS;

  return transitions[from] ?? [];
}
