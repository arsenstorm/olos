export type DeliveryCacheTarget =
  | "manifest"
  | "media-object"
  | "negative-object";

export interface DeliveryCachePolicy {
  cacheControl: string;
  maxAgeSeconds: number;
  target: DeliveryCacheTarget;
}
