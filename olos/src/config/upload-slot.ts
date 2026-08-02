/**
 * Upload slot lifecycle states, from `issued` through `upload_observed` to
 * `committed`, with `expired`, `rejected`, and `revoked` as failure exits.
 * `UploadSlotState` (olos/types) is the derived union type.
 */
export const UPLOAD_SLOT_STATES = [
  "issued",
  "upload_observed",
  "committed",
  "expired",
  "rejected",
  "revoked",
] as const;

/**
 * Allowed upload slot state transitions, keyed by current state. States
 * absent from the map (`expired`, `rejected`, `revoked`) are terminal.
 * Enforced by `canTransitionUploadSlot` / `assertUploadSlotTransition`
 * (olos/state).
 */
export const UPLOAD_SLOT_TRANSITIONS = {
  committed: ["revoked"],
  issued: ["upload_observed", "expired", "revoked"],
  upload_observed: ["committed", "rejected", "revoked"],
} as const;
