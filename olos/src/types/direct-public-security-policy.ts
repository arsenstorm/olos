import type { DeliveryCachePolicy } from "./cache-policy";

/**
 * Hardening rules for `direct-public` publication, where uploads land
 * directly on the public origin. Built with
 * `createDirectPublicSecurityPolicy` (olos/state) and consulted per request
 * via `resolveDirectPublicObjectRequestPolicy`.
 */
export interface DirectPublicSecurityPolicy {
  /** Origins allowed to fetch media (CORS allow-list). */
  allowedDeliveryOrigins: readonly string[];
  /**
   * Object file extensions (with leading dot) that may be served. Supplied
   * by the media profile (e.g. `.m4s`/`.mp4` for CMAF/LL-HLS), not Core.
   */
  allowedObjectExtensions: readonly string[];
  /** Response headers that must never reach clients (e.g. upload metadata). */
  forbiddenResponseHeaders: readonly string[];
  manifestCachePolicy: DeliveryCachePolicy;
  mediaObjectCachePolicy: DeliveryCachePolicy;
  /** Cache policy for 404-class responses to not-yet-published objects. */
  negativeObjectCachePolicy: DeliveryCachePolicy;
  /**
   * Content type stamped on every served object. Supplied by the media
   * profile (e.g. `video/mp4` for CMAF/LL-HLS), not Core.
   */
  objectContentType: string;
  /** Headers stamped on every object response (e.g. CSP, nosniff). */
  objectResponseHeaders: Readonly<Record<string, string>>;
}
