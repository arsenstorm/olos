export const UPLOAD_SLOT_STATES = [
  "issued",
  "upload_observed",
  "committed",
  "expired",
  "rejected",
  "revoked",
] as const;

export const UPLOAD_SLOT_TRANSITIONS = {
  committed: ["revoked"],
  issued: ["upload_observed", "expired", "revoked"],
  upload_observed: ["committed", "rejected", "revoked"],
} as const;
