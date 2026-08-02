import type { DeliveryCachePolicy } from "./cache-policy";

/**
 * Hardening rules for `direct-public` publication, where uploads land
 * directly on the public origin. Built with
 * `createDirectPublicSecurityPolicy` (olos/state) and consulted per request
 * via `resolveDirectPublicMediaRequestPolicy`.
 */
export interface DirectPublicSecurityPolicy {
  /** Media file extensions (with leading dot) that may be served. */
  allowedMediaExtensions: readonly string[];
  /** Origins allowed to fetch media (CORS allow-list). */
  allowedMediaOrigins: readonly string[];
  /** Response headers that must never reach clients (e.g. upload metadata). */
  forbiddenResponseHeaders: readonly string[];
  manifestCachePolicy: DeliveryCachePolicy;
  mediaObjectCachePolicy: DeliveryCachePolicy;
  /** Headers stamped on every media response (e.g. CSP, nosniff). */
  mediaResponseHeaders: Readonly<Record<string, string>>;
  /** Cache policy for 404-class responses to not-yet-published objects. */
  negativeObjectCachePolicy: DeliveryCachePolicy;
}
