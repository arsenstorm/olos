export const SESSION_STATES = [
  "created",
  "starting",
  "live",
  "ending",
  "ended",
  "aborted",
  "expired",
] as const;

export const LATENCY_PROFILES = [
  "object-standard",
  "object-ll",
  "object-experimental",
  "origin-ll",
  "relay-bridge",
] as const;

export const RENDITION_KINDS = ["audio", "video", "text", "metadata"] as const;
