export const PROVIDER_KINDS = ["object-store"] as const;

export const PROVIDER_CONSISTENCY_LEVELS = [
  "strong",
  "eventual",
  "unknown",
] as const;

export const PROVIDER_EVENT_DELIVERY_MODES = [
  "none",
  "best-effort",
  "at-least-once",
  "exactly-once",
] as const;
