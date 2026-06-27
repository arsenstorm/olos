export const SESSION_STATES = [
  "created",
  "starting",
  "live",
  "ending",
  "ended",
  "aborted",
  "expired",
] as const;

export const SESSION_TRANSITIONS = {
  created: ["starting", "aborted"],
  ending: ["ended"],
  live: ["ending", "aborted", "expired"],
  starting: ["live", "aborted"],
} as const;

export const LATENCY_PROFILES = ["object-ll"] as const;

export const RENDITION_KINDS = ["audio", "video", "text", "metadata"] as const;
