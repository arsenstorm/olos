import type { DeliveryCachePolicy } from "./cache-policy";

export interface DirectPublicSecurityPolicy {
  allowedMediaExtensions: readonly string[];
  allowedMediaOrigins: readonly string[];
  forbiddenResponseHeaders: readonly string[];
  manifestCachePolicy: DeliveryCachePolicy;
  mediaObjectCachePolicy: DeliveryCachePolicy;
  mediaResponseHeaders: Readonly<Record<string, string>>;
  negativeObjectCachePolicy: DeliveryCachePolicy;
}
