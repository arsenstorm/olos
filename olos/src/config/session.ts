export const SESSION_STATES = ["live", "ending", "ended", "aborted"] as const;

export const SESSION_TRANSITIONS = {
  ending: ["ended"],
  live: ["ending", "aborted"],
} as const;

export const LATENCY_PROFILES = ["object-ll"] as const;

export const RENDITION_KINDS = ["audio", "video", "text", "metadata"] as const;
