/**
 * What a delivery cache policy applies to: playlists (`manifest`), committed
 * media (`media-object`), or 404-class responses for objects that are not
 * yet published (`negative-object`).
 */
export type DeliveryCacheTarget =
  | "manifest"
  | "media-object"
  | "negative-object";

/** HTTP caching directives for one class of delivery response. */
export interface DeliveryCachePolicy {
  /** Complete `Cache-Control` header value to send. */
  cacheControl: string;
  /** The `max-age` encoded in `cacheControl`, in seconds. */
  maxAgeSeconds: number;
  target: DeliveryCacheTarget;
}
