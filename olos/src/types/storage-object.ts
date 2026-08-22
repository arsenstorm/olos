/**
 * The object kinds OLOS can issue upload slots for: `init` (a track's
 * optional initialization object, published once), `segment` (one full
 * sequence position), and `part` (a partial segment that becomes visible
 * before the full segment lands). `ObjectKind` (olos/types) is the derived
 * union type.
 */
export const OBJECT_KINDS = ["init", "part", "segment"] as const;

/** Kind of object a slot carries: `init`, `part`, or `segment`. */
export type ObjectKind = (typeof OBJECT_KINDS)[number];

/**
 * Provider-observed facts about an uploaded object (from a HEAD request or
 * an object-created event) — the evidence OLOS checks against the slot
 * before committing.
 */
export interface StorageObject {
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
