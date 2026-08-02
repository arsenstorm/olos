import type { MEDIA_OBJECT_KINDS } from "../config/media-object";

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
