/**
 * The media object kinds OLOS can issue upload slots for: `init` (CMAF
 * initialization segment), `part` (LL-HLS partial segment), and `segment`
 * (full segment). `MediaObjectKind` (olos/types) is the derived union type.
 */
export const MEDIA_OBJECT_KINDS = ["init", "part", "segment"] as const;

/** Kind of media object a slot carries: `init`, `part`, or `segment`. */
export type MediaObjectKind = (typeof MEDIA_OBJECT_KINDS)[number];

/**
 * Provider-observed facts about an uploaded object (from a HEAD request or
 * an object-created event) — the evidence OLOS checks against the slot
 * before committing.
 */
export interface MediaObject {
  contentType: string;
  /** Provider ETag, when the observation source exposes one. */
  etag?: string;
  objectKey: string;
  /** ISO 8601 timestamp of when the provider observed the object. */
  observedAt: string;
  providerId: string;
  /** Observed object size in bytes. */
  size: number;
}
